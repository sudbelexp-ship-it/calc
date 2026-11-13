"""Exercise OCR with every Python socket connection blocked. Run after install.bat."""
import socket
import cv2
import numpy as np
import doctor
import ocr


def blocked(*args, **kwargs):
    raise RuntimeError('Network intentionally disabled during offline smoke test')


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--formula',help='Optional local formula crop, after install-formulas.bat')
    args=parser.parse_args()
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked
    doctor.check()
    image = np.full((160, 850, 3), 255, np.uint8)
    cv2.putText(image, '12345 67.89', (20, 100), cv2.FONT_HERSHEY_SIMPLEX,
                2, (0, 0, 0), 3, cv2.LINE_AA)
    words = ocr.ocr_words(image)
    result = ' '.join(w['t'] for w in words)
    if '12345' not in result:
        raise RuntimeError('OCR did not find the smoke-test number: ' + result)
    ocr.set_precise(True)
    text, confidence, variants = ocr.recognize_line(image)
    if not text:
        raise RuntimeError('Precise recognizer returned no text')
    print('PASS: standard and SERVER numeric recognizers work with sockets blocked')
    if args.formula:
        import formulas
        result=formulas.recognize(args.formula)
        if result['verified'] or not result['latex']:
            raise RuntimeError('Invalid formula result state')
        print(f"PASS: local formula recognizer with sockets blocked ({result['seconds']} s); LaTeX remains unverified")


if __name__ == '__main__':
    main()
