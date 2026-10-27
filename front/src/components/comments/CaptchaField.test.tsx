import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { CaptchaField } from './CaptchaField';

const props = () => ({ value: '', refreshKey: 0, onChange: vi.fn(), onToken: vi.fn() });

describe('CaptchaField', () => {
  it('загружает картинку и отдаёт токен', async () => {
    vi.spyOn(api, 'getCaptcha').mockResolvedValue({ token: 'tok1', image: 'data:image/svg+xml;base64,AAA' });
    const p = props();
    render(<CaptchaField {...p} />);

    expect(await screen.findByAltText('CAPTCHA')).toHaveAttribute('src', 'data:image/svg+xml;base64,AAA');
    expect(p.onToken).toHaveBeenCalledWith('tok1');
  });

  it('ошибка загрузки и повтор по кнопке', async () => {
    const get = vi.spyOn(api, 'getCaptcha').mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ token: 't2', image: 'img2' });
    const p = props();
    render(<CaptchaField {...p} />);

    expect(await screen.findByText('Ошибка загрузки')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Обновить CAPTCHA' }));
    expect(await screen.findByAltText('CAPTCHA')).toHaveAttribute('src', 'img2');
    expect(get).toHaveBeenCalledTimes(2);
    expect(p.onToken).toHaveBeenCalledWith('t2');
  });

  it('смена refreshKey перезагружает капчу', async () => {
    const get = vi.spyOn(api, 'getCaptcha').mockResolvedValue({ token: 't', image: 'i' });
    const p = props();
    const { rerender } = render(<CaptchaField {...p} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    rerender(<CaptchaField {...p} refreshKey={1} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('ввод и ошибка поля', async () => {
    vi.spyOn(api, 'getCaptcha').mockResolvedValue({ token: 't', image: 'i' });
    const p = props();
    render(<CaptchaField {...p} error="Неверная CAPTCHA" />);
    expect(screen.getByText('…')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Текст с картинки'), 'a');
    expect(p.onChange).toHaveBeenCalledWith('a');
    expect(screen.getByText('Неверная CAPTCHA')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Текст с картинки')).toHaveClass('invalid');
    await screen.findByAltText('CAPTCHA');
  });
});
