'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import type { Messages } from '@/lib/i18n';
import { uploadFile } from '@/lib/upload';
import { validateFile } from '@/lib/validation';

export type DirectUploadState =
  | { status: 'idle' }
  | { status: 'uploading' | 'processing'; file: File; progress: number }
  | { status: 'ready'; file: File; uploadId: string }
  // текст ошибки собирается в рендере (uploadErrorText), чтобы переводиться при смене языка:
  // local — не прошёл проверку на клиенте, code — ошибка обработки, error — сообщение сервера
  | { status: 'error'; file: File | null; local?: boolean; code?: string; error?: string };

export function uploadErrorText(state: Extract<DirectUploadState, { status: 'error' }>, t: Messages): string {
  if (state.local && state.file) return validateFile(state.file) ?? t.file.uploadFailed;
  if (state.code && t.file.errors[state.code]) return t.file.errors[state.code];
  return state.error ?? t.file.uploadFailed;
}

// Загрузка стартует сразу при выборе файла, к моменту отправки формы остаётся только uploadId
export function useDirectUpload() {
  const [state, setState] = useState<DirectUploadState>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: 'idle' });
  }, []);

  const start = useCallback(
    async (file: File | null) => {
      clear();
      if (!file) return;

      const localError = validateFile(file);
      if (localError) return setState({ status: 'error', file, local: true });

      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: 'uploading', file, progress: 0 });

      try {
        const result = await uploadFile(file, {
          signal: controller.signal,
          onProgress: (progress) => setState((prev) => (prev.status === 'uploading' ? { ...prev, progress } : prev)),
          onPhase: (phase) => phase === 'processing' && setState({ status: 'processing', file, progress: 1 }),
        });
        if (!controller.signal.aborted) setState({ status: 'ready', file, uploadId: result.uploadId });
      } catch (e) {
        if (controller.signal.aborted) return;
        setState(e instanceof ApiError ? { status: 'error', file, code: e.code, error: e.message } : { status: 'error', file });
      }
    },
    [clear],
  );

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { state, start, clear };
}
