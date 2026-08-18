#include <jni.h>

#include <android/api-level.h>
#include <dlfcn.h>
#include <elf.h>
#include <fcntl.h>
#include <linux/futex.h>
#include <link.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <ucontext.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <cstddef>
#include <cstring>
#include <initializer_list>
#include <limits>

namespace {

constexpr uint32_t kJournalVersion = 1;
constexpr size_t kMaximumFrames = 64;
constexpr size_t kMaximumModules = 512;
constexpr size_t kUserBytes = 513;
constexpr size_t kReleaseBytes = 1025;
constexpr size_t kDistBytes = 1025;
constexpr size_t kEnvironmentBytes = 1025;
constexpr size_t kBuildIdBytes = 65;
constexpr size_t kFilenameBytes = 129;
[[maybe_unused]] constexpr uintptr_t kMaximumFrameDistance = 8U * 1024U * 1024U;
constexpr int kCapturedSignals[] = {SIGILL, SIGTRAP, SIGABRT, SIGBUS, SIGFPE, SIGSEGV};

#pragma pack(push, 1)
struct JournalFrame {
  uint64_t instruction_address;
  uint64_t image_address;
  uint64_t relative_pc;
  uint8_t in_app;
  char build_id[kBuildIdBytes];
  char filename[kFilenameBytes];
};

struct Journal {
  char magic[8];
  uint32_t version;
  uint32_t total_size;
  uint32_t checksum;
  int32_t signal_number;
  int32_t signal_code;
  uint64_t fault_address;
  int64_t timestamp_ms;
  uint32_t frame_count;
  char user_id[kUserBytes];
  char release[kReleaseBytes];
  char dist[kDistBytes];
  char environment[kEnvironmentBytes];
  JournalFrame frames[kMaximumFrames];
};
#pragma pack(pop)

static_assert(sizeof(Journal) == 17652, "The Kotlin and native journal contracts must remain identical");
static_assert(std::atomic<int>::is_always_lock_free, "Crash coordination requires lock-free integer atomics");
static_assert(std::atomic<uint32_t>::is_always_lock_free, "Crash snapshots require lock-free sequence atomics");

struct MetadataSnapshot {
  bool enabled;
  char user_id[kUserBytes];
  char release[kReleaseBytes];
  char dist[kDistBytes];
  char environment[kEnvironmentBytes];
};

struct ModuleSnapshot {
  uintptr_t start;
  uintptr_t end;
  uintptr_t image_address;
  bool in_app;
  char build_id[kBuildIdBytes];
  char filename[kFilenameBytes];
};

struct CrashRecord {
  int signal_number;
  pid_t thread_id;
  siginfo_t signal_info;
  ucontext_t user_context;
  MetadataSnapshot metadata;
  uint32_t module_sequence;
};

struct RegisterSnapshot {
  uintptr_t program_counter;
  uintptr_t stack_pointer;
  uintptr_t frame_pointer;
  uintptr_t link_register;
};

alignas(4) int g_crash_state = 0;
volatile sig_atomic_t g_enabled = 1;
int g_directory_fd = -1;
int g_memory_fd = -1;
int g_pipe[2] = {-1, -1};
CrashRecord g_crash_record{};
struct sigaction g_previous_actions[sizeof(kCapturedSignals) / sizeof(kCapturedSignals[0])]{};
alignas(16) uint8_t g_main_alt_stack[64U * 1024U]{};

pthread_mutex_t g_configuration_mutex = PTHREAD_MUTEX_INITIALIZER;
std::atomic<uint32_t> g_metadata_sequence{0};
MetadataSnapshot g_metadata{true, {}, {}, {}, {}};
std::atomic<uint32_t> g_module_sequence{0};
std::atomic<bool> g_modules_frozen{false};
size_t g_module_count = 0;
ModuleSnapshot g_modules[kMaximumModules]{};

size_t bounded_length(const char* value, size_t maximum) {
  if (value == nullptr) return 0;
  size_t length = 0;
  while (length < maximum && value[length] != '\0') ++length;
  return length;
}

void copy_bounded(char* destination, size_t destination_size, const char* source) {
  if (destination_size == 0) return;
  const size_t length = bounded_length(source, destination_size - 1);
  if (length > 0) std::memcpy(destination, source, length);
  destination[length] = '\0';
}

const char* basename_pointer(const char* path) {
  if (path == nullptr || path[0] == '\0') return "<unknown>";
  const char* result = path;
  for (const char* cursor = path; *cursor != '\0'; ++cursor) {
    if (*cursor == '/') result = cursor + 1;
  }
  return result[0] == '\0' ? "<unknown>" : result;
}

bool path_is_application_image(const char* path) {
  if (path == nullptr) return false;
  return std::strncmp(path, "/data/app/", 10) == 0 || std::strncmp(path, "/data/user/", 11) == 0 ||
      std::strncmp(path, "/data/data/", 11) == 0;
}

uintptr_t align_note(size_t value) {
  return (value + 3U) & ~static_cast<uintptr_t>(3U);
}

void copy_build_id(const dl_phdr_info* info, char* destination) {
  constexpr char kHex[] = "0123456789abcdef";
  for (ElfW(Half) index = 0; index < info->dlpi_phnum; ++index) {
    const ElfW(Phdr)& header = info->dlpi_phdr[index];
    if (header.p_type != PT_NOTE || header.p_memsz < sizeof(ElfW(Nhdr)) || header.p_memsz > 64U * 1024U) continue;
    const auto* note = reinterpret_cast<const uint8_t*>(info->dlpi_addr + header.p_vaddr);
    size_t offset = 0;
    while (offset + sizeof(ElfW(Nhdr)) <= header.p_memsz) {
      ElfW(Nhdr) note_header{};
      std::memcpy(&note_header, note + offset, sizeof(note_header));
      offset += sizeof(note_header);
      const size_t name_bytes = align_note(note_header.n_namesz);
      const size_t descriptor_bytes = align_note(note_header.n_descsz);
      if (name_bytes > header.p_memsz - offset || descriptor_bytes > header.p_memsz - offset - name_bytes) break;
      const uint8_t* name = note + offset;
      const uint8_t* descriptor = note + offset + name_bytes;
      if (note_header.n_type == NT_GNU_BUILD_ID && note_header.n_namesz >= 3 && std::memcmp(name, "GNU", 3) == 0) {
        const size_t build_id_bytes = note_header.n_descsz < 32 ? note_header.n_descsz : 32;
        for (size_t byte_index = 0; byte_index < build_id_bytes; ++byte_index) {
          destination[byte_index * 2] = kHex[descriptor[byte_index] >> 4U];
          destination[(byte_index * 2) + 1] = kHex[descriptor[byte_index] & 0x0fU];
        }
        destination[build_id_bytes * 2] = '\0';
        return;
      }
      offset += name_bytes + descriptor_bytes;
    }
  }
}

int collect_module(dl_phdr_info* info, size_t, void*) {
  if (g_module_count >= kMaximumModules) return 1;
  uintptr_t start = std::numeric_limits<uintptr_t>::max();
  uintptr_t end = 0;
  for (ElfW(Half) index = 0; index < info->dlpi_phnum; ++index) {
    const ElfW(Phdr)& header = info->dlpi_phdr[index];
    if (header.p_type != PT_LOAD || header.p_memsz == 0) continue;
    const uintptr_t segment_start = info->dlpi_addr + header.p_vaddr;
    const uintptr_t segment_end = segment_start + header.p_memsz;
    if (segment_end < segment_start) continue;
    if (segment_start < start) start = segment_start;
    if (segment_end > end) end = segment_end;
  }
  if (start == std::numeric_limits<uintptr_t>::max() || end <= start) return 0;

  ModuleSnapshot& module = g_modules[g_module_count++];
  module = {};
  module.start = start;
  module.end = end;
  module.image_address = info->dlpi_addr;
  module.in_app = path_is_application_image(info->dlpi_name);
  copy_bounded(module.filename, sizeof(module.filename), basename_pointer(info->dlpi_name));
  copy_build_id(info, module.build_id);
  return 0;
}

void refresh_modules() {
  g_module_sequence.fetch_add(1, std::memory_order_acq_rel);
  g_module_count = 0;
  std::memset(g_modules, 0, sizeof(g_modules));
  dl_iterate_phdr(collect_module, nullptr);
  g_module_sequence.fetch_add(1, std::memory_order_release);
}

bool copy_metadata(MetadataSnapshot* output) {
  for (int attempt = 0; attempt < 3; ++attempt) {
    const uint32_t before = g_metadata_sequence.load(std::memory_order_acquire);
    if ((before & 1U) != 0) continue;
    std::memcpy(output, &g_metadata, sizeof(*output));
    const uint32_t after = g_metadata_sequence.load(std::memory_order_acquire);
    if (before == after) return true;
  }
  *output = {};
  return false;
}

const ModuleSnapshot* resolve_module(uintptr_t address, uint32_t expected_sequence) {
  if (address == 0 || g_module_sequence.load(std::memory_order_acquire) != expected_sequence) return nullptr;
  for (size_t index = 0; index < g_module_count; ++index) {
    const ModuleSnapshot& module = g_modules[index];
    if (address >= module.start && address < module.end) return &module;
  }
#if defined(__aarch64__)
  const uintptr_t stripped = address & static_cast<uintptr_t>(0x00ffffffffffffffULL);
  if (stripped != address) return resolve_module(stripped, expected_sequence);
#endif
  return nullptr;
}

RegisterSnapshot registers_from(const ucontext_t& context) {
#if defined(__aarch64__)
  return {static_cast<uintptr_t>(context.uc_mcontext.pc), static_cast<uintptr_t>(context.uc_mcontext.sp),
      static_cast<uintptr_t>(context.uc_mcontext.regs[29]), static_cast<uintptr_t>(context.uc_mcontext.regs[30])};
#elif defined(__arm__)
  return {static_cast<uintptr_t>(context.uc_mcontext.arm_pc), static_cast<uintptr_t>(context.uc_mcontext.arm_sp),
      static_cast<uintptr_t>(context.uc_mcontext.arm_fp), static_cast<uintptr_t>(context.uc_mcontext.arm_lr)};
#elif defined(__x86_64__)
  return {static_cast<uintptr_t>(context.uc_mcontext.gregs[REG_RIP]), static_cast<uintptr_t>(context.uc_mcontext.gregs[REG_RSP]),
      static_cast<uintptr_t>(context.uc_mcontext.gregs[REG_RBP]), 0};
#elif defined(__i386__)
  return {static_cast<uintptr_t>(context.uc_mcontext.gregs[REG_EIP]), static_cast<uintptr_t>(context.uc_mcontext.gregs[REG_ESP]),
      static_cast<uintptr_t>(context.uc_mcontext.gregs[REG_EBP]), 0};
#else
  return {};
#endif
}

[[maybe_unused]] bool read_process_memory(uintptr_t address, void* output, size_t size) {
  if (g_memory_fd < 0 || address > static_cast<uintptr_t>(std::numeric_limits<off_t>::max())) return false;
  size_t completed = 0;
  while (completed < size) {
    const ssize_t count = pread(g_memory_fd, static_cast<uint8_t*>(output) + completed, size - completed,
        static_cast<off_t>(address + completed));
    if (count <= 0) return false;
    completed += static_cast<size_t>(count);
  }
  return true;
}

bool append_frame(Journal* journal, uintptr_t address, uint32_t module_sequence) {
  if (address == 0 || journal->frame_count >= kMaximumFrames) return false;
  for (uint32_t index = 0; index < journal->frame_count; ++index) {
    if (journal->frames[index].instruction_address == address) return false;
  }

  JournalFrame& frame = journal->frames[journal->frame_count++];
  frame.instruction_address = address;
  const ModuleSnapshot* module = resolve_module(address, module_sequence);
  if (module == nullptr && address > 0) module = resolve_module(address - 1, module_sequence);
  if (module == nullptr) {
    copy_bounded(frame.filename, sizeof(frame.filename), "<unknown>");
    return true;
  }
  frame.image_address = module->image_address;
  frame.relative_pc = address - module->image_address;
  frame.in_app = module->in_app ? 1 : 0;
  copy_bounded(frame.build_id, sizeof(frame.build_id), module->build_id);
  copy_bounded(frame.filename, sizeof(frame.filename), module->filename);
  return true;
}

void collect_frames(Journal* journal, const ucontext_t& context, uint32_t module_sequence) {
  if ((module_sequence & 1U) != 0) return;
  const RegisterSnapshot registers = registers_from(context);
  append_frame(journal, registers.program_counter, module_sequence);
  append_frame(journal, registers.link_register, module_sequence);

#if defined(__aarch64__) || defined(__x86_64__) || defined(__i386__)
  uintptr_t frame_pointer = registers.frame_pointer;
  for (size_t index = journal->frame_count; index < kMaximumFrames; ++index) {
    if (frame_pointer < registers.stack_pointer || frame_pointer - registers.stack_pointer > kMaximumFrameDistance ||
        (frame_pointer % alignof(uintptr_t)) != 0) {
      break;
    }
    uintptr_t frame[2]{};
    if (!read_process_memory(frame_pointer, frame, sizeof(frame))) break;
    const uintptr_t next_frame_pointer = frame[0];
    const uintptr_t return_address = frame[1];
    append_frame(journal, return_address, module_sequence);
    if (next_frame_pointer <= frame_pointer || next_frame_pointer - registers.stack_pointer > kMaximumFrameDistance) break;
    frame_pointer = next_frame_pointer;
  }
#endif
}

uint32_t crc32(const uint8_t* bytes, size_t size) {
  uint32_t result = 0xffffffffU;
  for (size_t index = 0; index < size; ++index) {
    result ^= bytes[index];
    for (int bit = 0; bit < 8; ++bit) result = (result >> 1U) ^ (0xedb88320U & (0U - (result & 1U)));
  }
  return ~result;
}

bool write_all(int descriptor, const uint8_t* bytes, size_t size) {
  size_t completed = 0;
  while (completed < size) {
    const ssize_t count = write(descriptor, bytes + completed, size - completed);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    completed += static_cast<size_t>(count);
  }
  return true;
}

char* append_unsigned(char* output, uint64_t value) {
  char reversed[24]{};
  size_t length = 0;
  do {
    reversed[length++] = static_cast<char>('0' + (value % 10U));
    value /= 10U;
  } while (value > 0 && length < sizeof(reversed));
  while (length > 0) *output++ = reversed[--length];
  return output;
}

void journal_names(char* temporary_name, char* final_name, pid_t thread_id) {
  char* final_cursor = final_name;
  for (const char value : {'p', 'e', 'n', 'd', 'i', 'n', 'g', '-'}) *final_cursor++ = value;
  final_cursor = append_unsigned(final_cursor, static_cast<uint64_t>(getpid()));
  *final_cursor++ = '-';
  final_cursor = append_unsigned(final_cursor, static_cast<uint64_t>(thread_id));
  for (const char value : {'.', 'b', 'i', 'n'}) *final_cursor++ = value;
  *final_cursor = '\0';

  char* temporary_cursor = temporary_name;
  for (const char value : {'.', 't', 'm', 'p', '-'}) *temporary_cursor++ = value;
  copy_bounded(temporary_cursor, 59, final_name);
}

void write_journal(const CrashRecord& crash) {
  Journal journal{};
  const char magic[8] = {'I', 'N', 'K', 'N', 'C', 'R', '1', '\0'};
  std::memcpy(journal.magic, magic, sizeof(magic));
  journal.version = kJournalVersion;
  journal.total_size = sizeof(journal);
  journal.signal_number = crash.signal_number;
  journal.signal_code = crash.signal_info.si_code;
  journal.fault_address = reinterpret_cast<uintptr_t>(crash.signal_info.si_addr);
  timespec current_time{};
  if (clock_gettime(CLOCK_REALTIME, &current_time) == 0) {
    journal.timestamp_ms = (static_cast<int64_t>(current_time.tv_sec) * 1000) + (current_time.tv_nsec / 1000000);
  }

  copy_bounded(journal.user_id, sizeof(journal.user_id), crash.metadata.user_id);
  copy_bounded(journal.release, sizeof(journal.release), crash.metadata.release);
  copy_bounded(journal.dist, sizeof(journal.dist), crash.metadata.dist);
  copy_bounded(journal.environment, sizeof(journal.environment), crash.metadata.environment);
  collect_frames(&journal, crash.user_context, crash.module_sequence);
  if (journal.frame_count == 0 || journal.timestamp_ms <= 0) return;

  constexpr size_t body_offset = offsetof(Journal, signal_number);
  journal.checksum = crc32(reinterpret_cast<const uint8_t*>(&journal) + body_offset, sizeof(journal) - body_offset);
  char temporary_name[64]{};
  char final_name[64]{};
  journal_names(temporary_name, final_name, crash.thread_id);
  const int file = openat(g_directory_fd, temporary_name, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (file < 0) return;
  const bool written = write_all(file, reinterpret_cast<const uint8_t*>(&journal), sizeof(journal));
  if (written) fsync(file);
  close(file);
  if (written) {
    if (renameat(g_directory_fd, temporary_name, g_directory_fd, final_name) == 0) fsync(g_directory_fd);
  } else {
    unlinkat(g_directory_fd, temporary_name, 0);
  }
}

void* crash_worker(void*) {
  uint8_t notification = 0;
  while (true) {
    const ssize_t count = read(g_pipe[0], &notification, sizeof(notification));
    if (count < 0 && errno == EINTR) continue;
    if (count != sizeof(notification)) continue;
    write_journal(g_crash_record);
    __atomic_store_n(&g_crash_state, 2, __ATOMIC_RELEASE);
    syscall(SYS_futex, &g_crash_state, FUTEX_WAKE_PRIVATE, 1, nullptr, nullptr, 0);
  }
}

const struct sigaction* previous_action_for(int signal_number) {
  for (size_t index = 0; index < sizeof(kCapturedSignals) / sizeof(kCapturedSignals[0]); ++index) {
    if (kCapturedSignals[index] == signal_number) return &g_previous_actions[index];
  }
  return nullptr;
}

void delegate_signal(int signal_number, siginfo_t* signal_info, void* user_context) {
  const struct sigaction* previous = previous_action_for(signal_number);
  if (previous != nullptr) sigaction(signal_number, previous, nullptr);
  const bool has_custom_handler = previous != nullptr && previous->sa_handler != SIG_DFL && previous->sa_handler != SIG_IGN &&
      previous->sa_handler != nullptr;
  if (has_custom_handler && (previous->sa_flags & SA_SIGINFO) != 0) {
    previous->sa_sigaction(signal_number, signal_info, user_context);
  } else if (has_custom_handler) {
    previous->sa_handler(signal_number);
  }

  struct sigaction default_action {};
  default_action.sa_handler = SIG_DFL;
  sigemptyset(&default_action.sa_mask);
  sigaction(signal_number, &default_action, nullptr);
  syscall(SYS_tgkill, getpid(), syscall(SYS_gettid), signal_number);
}

void crash_signal_handler(int signal_number, siginfo_t* signal_info, void* user_context) {
  int expected = 0;
  const bool should_capture = g_enabled != 0 &&
      __atomic_compare_exchange_n(&g_crash_state, &expected, 1, false, __ATOMIC_ACQ_REL, __ATOMIC_RELAXED);
  if (should_capture && signal_info != nullptr && user_context != nullptr) {
    g_crash_record.signal_number = signal_number;
    g_crash_record.thread_id = static_cast<pid_t>(syscall(SYS_gettid));
    g_crash_record.signal_info = *signal_info;
    g_crash_record.user_context = *static_cast<ucontext_t*>(user_context);
    copy_metadata(&g_crash_record.metadata);
    g_crash_record.module_sequence = g_module_sequence.load(std::memory_order_acquire);
    const uint8_t notification = 1;
    if (write(g_pipe[1], &notification, sizeof(notification)) == sizeof(notification)) {
      timespec timeout{2, 0};
      while (__atomic_load_n(&g_crash_state, __ATOMIC_ACQUIRE) == 1) {
        const long result = syscall(SYS_futex, &g_crash_state, FUTEX_WAIT_PRIVATE, 1, &timeout, nullptr, 0);
        if (result < 0 && errno != EINTR) break;
      }
    }
  }
  delegate_signal(signal_number, signal_info, user_context);
}

bool install_handlers() {
  stack_t alternative_stack{};
  alternative_stack.ss_sp = g_main_alt_stack;
  alternative_stack.ss_size = sizeof(g_main_alt_stack);
  alternative_stack.ss_flags = 0;
  if (sigaltstack(&alternative_stack, nullptr) != 0) return false;

  struct sigaction action {};
  action.sa_sigaction = crash_signal_handler;
  action.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigfillset(&action.sa_mask);
  size_t installed = 0;
  for (; installed < sizeof(kCapturedSignals) / sizeof(kCapturedSignals[0]); ++installed) {
    if (sigaction(kCapturedSignals[installed], &action, &g_previous_actions[installed]) != 0) break;
  }
  if (installed == sizeof(kCapturedSignals) / sizeof(kCapturedSignals[0])) return true;
  for (size_t index = 0; index < installed; ++index) sigaction(kCapturedSignals[index], &g_previous_actions[index], nullptr);
  return false;
}

jboolean native_install(JNIEnv* environment, jobject, jstring directory_path, jint sdk_int) {
  if (sdk_int < 21 || sdk_int > 30 || directory_path == nullptr || g_directory_fd >= 0) return JNI_FALSE;
  const char* path = environment->GetStringUTFChars(directory_path, nullptr);
  if (path == nullptr) return JNI_FALSE;
  g_directory_fd = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  environment->ReleaseStringUTFChars(directory_path, path);
  if (g_directory_fd < 0) return JNI_FALSE;

  g_memory_fd = open("/proc/self/mem", O_RDONLY | O_CLOEXEC);
  if (pipe(g_pipe) != 0) return JNI_FALSE;
  fcntl(g_pipe[0], F_SETFD, FD_CLOEXEC);
  fcntl(g_pipe[1], F_SETFD, FD_CLOEXEC);
  refresh_modules();

  pthread_t worker{};
  if (pthread_create(&worker, nullptr, crash_worker, nullptr) != 0) return JNI_FALSE;
  pthread_detach(worker);
  return install_handlers() ? JNI_TRUE : JNI_FALSE;
}

void copy_java_string(JNIEnv* environment, jobjectArray values, jsize index, char* destination, size_t destination_size) {
  const auto value = static_cast<jstring>(environment->GetObjectArrayElement(values, index));
  if (value == nullptr) {
    destination[0] = '\0';
    return;
  }
  const char* characters = environment->GetStringUTFChars(value, nullptr);
  if (characters != nullptr) {
    copy_bounded(destination, destination_size, characters);
    environment->ReleaseStringUTFChars(value, characters);
  }
  environment->DeleteLocalRef(value);
}

void native_configure(JNIEnv* environment, jobject, jobjectArray values) {
  if (values == nullptr || environment->GetArrayLength(values) != 5) return;
  pthread_mutex_lock(&g_configuration_mutex);
  MetadataSnapshot next_metadata{};
  char enabled[2]{};
  copy_java_string(environment, values, 0, enabled, sizeof(enabled));
  next_metadata.enabled = enabled[0] == '1';
  copy_java_string(environment, values, 1, next_metadata.user_id, sizeof(next_metadata.user_id));
  copy_java_string(environment, values, 2, next_metadata.release, sizeof(next_metadata.release));
  copy_java_string(environment, values, 3, next_metadata.dist, sizeof(next_metadata.dist));
  copy_java_string(environment, values, 4, next_metadata.environment, sizeof(next_metadata.environment));

  const bool needs_module_refresh = !g_modules_frozen.exchange(true, std::memory_order_acq_rel);
  if (needs_module_refresh) g_enabled = 0;
  g_metadata_sequence.fetch_add(1, std::memory_order_acq_rel);
  g_metadata = next_metadata;
  g_metadata_sequence.fetch_add(1, std::memory_order_release);
  if (needs_module_refresh) refresh_modules();
  g_enabled = next_metadata.enabled ? 1 : 0;
  pthread_mutex_unlock(&g_configuration_mutex);
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* virtual_machine, void*) {
  JNIEnv* environment = nullptr;
  if (virtual_machine->GetEnv(reinterpret_cast<void**>(&environment), JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
  jclass capture_class = environment->FindClass("com/inkronik/reactnative/AndroidNativeCrashCapture");
  if (capture_class == nullptr) return JNI_ERR;
  const JNINativeMethod methods[] = {
      {const_cast<char*>("nativeInstall"), const_cast<char*>("(Ljava/lang/String;I)Z"), reinterpret_cast<void*>(native_install)},
      {const_cast<char*>("nativeConfigure"), const_cast<char*>("([Ljava/lang/String;)V"), reinterpret_cast<void*>(native_configure)},
  };
  const jint result = environment->RegisterNatives(capture_class, methods, sizeof(methods) / sizeof(methods[0]));
  environment->DeleteLocalRef(capture_class);
  return result == JNI_OK ? JNI_VERSION_1_6 : JNI_ERR;
}
