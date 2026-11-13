"""Small reproducible real OCR resource smoke test; not a full-document benchmark."""
import ctypes
import json
import os
import time
import numpy as np
import ocr
import cv2

img = np.full((1200, 900, 3), 255, np.uint8)
for y in range(100, 1150, 70):
    cv2.putText(img, '12345 67.89 8509-93', (50,y), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,0,0), 2)
start, cpu = time.perf_counter(), time.process_time()
words = ocr.ocr_words(img)
ocr.recognize_line(img[50:130, 30:850])
elapsed, used = time.perf_counter()-start, time.process_time()-cpu
result = {'logical_cpus': os.cpu_count(), 'thread_budget': ocr.RES.THREADS,
          'wall_seconds': round(elapsed,3), 'cpu_seconds': round(used,3),
          'average_machine_cpu_percent': round(used/elapsed/(os.cpu_count() or 1)*100,2),
          'recognized_words': len(words), 'ram': ocr.RES.memory()}
if os.name == 'nt':
    class Counters(ctypes.Structure):
        _fields_ = [('cb',ctypes.c_ulong), ('faults',ctypes.c_ulong)] + [(name,ctypes.c_size_t) for name in
            ('peak_working_set','working_set','peak_paged','paged','peak_nonpaged','nonpaged','pagefile','peak_pagefile')]
    counters= Counters(); counters.cb=ctypes.sizeof(counters)
    kernel=ctypes.windll.kernel32
    kernel.GetCurrentProcess.restype=ctypes.c_void_p
    fn=ctypes.windll.psapi.GetProcessMemoryInfo
    fn.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
    if fn(kernel.GetCurrentProcess(),ctypes.byref(counters),counters.cb):
        result['peak_working_set_mb']=round(counters.peak_working_set/1024**2,1)
print(json.dumps(result))
