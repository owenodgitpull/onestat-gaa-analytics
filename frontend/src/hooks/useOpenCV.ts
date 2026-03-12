import { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    cv: any;
  }
}

export function useOpenCV() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    // Already loaded
    if (window.cv && window.cv.Mat) {
      setReady(true);
      return;
    }

    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.10.0/opencv.js';
    script.async = true;

    script.onload = () => {
      // OpenCV.js sets up cv as a promise or module
      const checkReady = () => {
        if (window.cv && window.cv.Mat) {
          setReady(true);
          setLoading(false);
        } else if (window.cv && typeof window.cv.then === 'function') {
          window.cv.then((cv: any) => {
            window.cv = cv;
            setReady(true);
            setLoading(false);
          });
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    };

    script.onerror = () => {
      setError('Failed to load OpenCV.js');
      setLoading(false);
      loadingRef.current = false;
    };

    document.head.appendChild(script);

    return () => {
      // Don't remove — OpenCV should stay loaded once loaded
    };
  }, []);

  return { cv: ready ? window.cv : null, loading, error, ready };
}
