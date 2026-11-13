"""Conservative process settings and memory checks; no GPU or driver installation."""
import os
import time
import ctypes
import contextlib
import threading
from pathlib import Path

_worker_local=threading.local()


@contextlib.contextmanager
def worker():
    """Prevent separate browser/batch processes from competing for OCR resources."""
    if getattr(_worker_local,'active',False):
        yield
        return
    lock_path=Path(__file__).with_name('.worker.lock')
    fd=os.open(lock_path,os.O_RDWR|os.O_CREAT,0o600)
    f=os.fdopen(fd,'r+b')
    try:
        if os.fstat(f.fileno()).st_size==0:
            f.write(b'0');f.flush()
        f.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError('Уже выполняется другое локальное задание OCR. Дождитесь завершения перед запуском второго процесса.') from exc
        _worker_local.active=True
        try:
            yield
        finally:
            _worker_local.active=False
            f.seek(0)
            if os.name=='nt':
                msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1)
            else:
                fcntl.flock(f.fileno(),fcntl.LOCK_UN)
    finally:
        f.close()

THREADS = max(1, min(4, (os.cpu_count() or 2) // 2))
for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[key] = str(THREADS)


def memory():
    if os.name != 'nt':
        return None
    class Status(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in
            ('total', 'available', 'page_total', 'page_available', 'virtual_total', 'virtual_available', 'extended')]
    status = Status()
    status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise OSError('Cannot read available RAM')
    return {'total': status.total, 'available': status.available}


def configure():
    import cv2
    cv2.setNumThreads(THREADS)
    if os.name == 'nt':
        # BELOW_NORMAL_PRIORITY_CLASS: foreground applications take precedence.
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        kernel.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        if not kernel.SetPriorityClass(kernel.GetCurrentProcess(), 0x4000):
            raise OSError('Cannot set background process priority')


def checkpoint():
    stats = memory()
    if stats:
        reserve = max(1536 * 1024 ** 2, int(stats['total'] * .20))
        if stats['available'] < reserve:
            raise RuntimeError('Недостаточно свободной памяти: оставляем системе 20% ОЗУ (не менее 1,5 ГБ). Закройте тяжёлые приложения и продолжите обработку.')
    time.sleep(.05)


def check_pixels(width, height):
    # Check before allocating render buffers. Never silently reduce resolution.
    pixels = int(width) * int(height)
    stats = memory()
    if pixels > 45_000_000:
        raise RuntimeError('Страница слишком большая: предел 45 мегапикселей. Разделите лист перед распознаванием.')
    if stats:
        reserve = max(1536 * 1024 ** 2, int(stats['total'] * .20))
        if pixels * 40 > stats['available'] - reserve:
            raise RuntimeError('Недостаточно памяти для страницы с выбранным разрешением. Уменьшите разрешение или освободите ОЗУ.')


def onnx_params():
    return {'EngineConfig.onnxruntime.intra_op_num_threads': THREADS,
            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
            'EngineConfig.onnxruntime.use_cuda': False,
            'EngineConfig.onnxruntime.enable_cpu_mem_arena': False}
