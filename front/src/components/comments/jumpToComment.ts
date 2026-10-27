import styles from './comments.module.css';

export const commentDomId = (uuid: string) => `comment-${uuid}`;

const FLASH_MS = 2000;

// Прокрутить к комментарию и кратко подсветить его. false — комментария нет на странице
export function jumpToComment(uuid: string): boolean {
  const element = document.getElementById(commentDomId(uuid));
  if (!element) return false;

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // к верху экрана; отступ под липкую шапку задаёт scroll-margin-top у .entry/.reply
  element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  // фокус для клавиатуры и скринридеров, без второго (резкого) скролла
  element.focus({ preventScroll: true });

  // перезапуск анимации, если по той же ссылке кликнули ещё раз
  element.classList.remove(styles.flash);
  void element.offsetWidth;
  element.classList.add(styles.flash);
  window.setTimeout(() => element.classList.remove(styles.flash), FLASH_MS);
  return true;
}
