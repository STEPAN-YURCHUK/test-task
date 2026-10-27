import styles from './comments.module.css';

// Цвет градиента стабильно выводится из имени — у одного автора всегда один цвет
function hueFromName(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`${styles.avatar} ${size === 'sm' ? styles.avatarSm : ''}`}
      style={{ '--hue': hueFromName(name) } as React.CSSProperties}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
