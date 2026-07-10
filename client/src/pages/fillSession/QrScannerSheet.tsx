// QR-сканер ложамента (design-system.md §6.8): серійне сканування, вібро, fallback вручну
import { useEffect, useRef, useState } from 'react';
import { Keyboard, RefreshCw } from 'lucide-react';
import jsQR from 'jsqr';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { useResolveApparatusByName } from '../../api/apparatus';
import type { Apparatus } from '../../api/types';

type ScanState = 'scanning' | 'found' | 'not_found' | 'no_permission';

export interface QrScannerSheetProps {
  addedCount: number;
  /** true = додано; false = дублікат (лічильник не росте) */
  onFound: (apparatus: Apparatus) => boolean;
  onManual: () => void;
  onClose: () => void;
}

export function QrScannerSheet({ addedCount, onFound, onManual, onClose }: QrScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<ScanState>('scanning');
  const [lastCode, setLastCode] = useState('');
  const resolveByName = useResolveApparatusByName();

  const stateRef = useRef<ScanState>('scanning');
  stateRef.current = state;
  const busyRef = useRef(false);
  const recentRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const handleCode = async (code: string) => {
      busyRef.current = true;
      setLastCode(code);
      try {
        const apparatus = await resolveByName(code);
        if (stopped) return;
        if (!apparatus) {
          setState('not_found');
          return;
        }
        const added = onFound(apparatus);
        if (added && navigator.vibrate) navigator.vibrate(80);
        setState('found');
        window.setTimeout(() => {
          if (!stopped) setState('scanning');
        }, 1200);
      } catch {
        if (!stopped) setState('not_found');
      } finally {
        busyRef.current = false;
      }
    };

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (
        video &&
        ctx &&
        video.readyState === video.HAVE_ENOUGH_DATA &&
        stateRef.current === 'scanning' &&
        !busyRef.current
      ) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(image.data, image.width, image.height);
        const code = result?.data.trim();
        if (code) {
          const now = Date.now();
          // не обробляємо той самий код повторно протягом 3 с (серійне сканування)
          if (recentRef.current.code !== code || now - recentRef.current.at > 3000) {
            recentRef.current = { code, at: now };
            void handleCode(code);
          }
        }
      }
      raf = window.requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        raf = window.requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!stopped) setState('no_permission');
      });

    return () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title={`Сканувати QR · Додано: ${addedCount}`} onClose={onClose} full>
      {state === 'no_permission' ? (
        <div className="state-block">
          <div className="state-block__title">Немає доступу до камери</div>
          <Button variant="secondary" onClick={onManual}>
            <Keyboard size={20} aria-hidden="true" />
            Ввести номер вручну
          </Button>
        </div>
      ) : (
        <>
          <div className="qr-video-wrap">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted />
            <div className={`qr-frame${state === 'found' ? ' qr-frame--found' : ''}`} aria-hidden="true" />
          </div>

          {state === 'scanning' && (
            <p className="field__hint" style={{ textAlign: 'center' }}>
              Наведіть на QR-код ложамента
            </p>
          )}
          {state === 'found' && (
            <div className="qr-result qr-result--ok" role="status">
              {lastCode} — додано
            </div>
          )}
          {state === 'not_found' && (
            <div className="qr-result qr-result--error" role="alert">
              Ложамент {lastCode} не знайдено на станції
              <Button variant="secondary" size="sm" onClick={() => setState('scanning')}>
                <RefreshCw size={18} aria-hidden="true" />
                Сканувати ще
              </Button>
            </div>
          )}

          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <Button variant="secondary" onClick={onManual}>
              <Keyboard size={20} aria-hidden="true" />
              Ввести номер
            </Button>
            <Button onClick={onClose}>Готово</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
