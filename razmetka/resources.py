"""Conservative process settings and memory checks; no GPU or driver installation."""
import os
import time
import ctypes

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
