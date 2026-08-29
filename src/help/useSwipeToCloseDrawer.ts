import { useEffect } from 'react';

interface Options {
  /** Порог в px по горизонтали (default: 60). */
  threshold?: number;
  /**
   * Направление свайпа для закрытия: 'right' — свайп вправо (drawer
   * справа, движется наружу). 'left' — свайп влево (drawer слева).
   * Default: 'right', так как у нас drawer всегда справа.
   */
  direction?: 'right' | 'left';
}

/**
 * Закрывает выдвижной drawer touch-свайпом. Слушает touchstart /
 * touchmove / touchend на `window`, но реагирует только пока drawer
 * открыт (управляется `active`). Горизонтальный свайп с превышением
 * порога вызывает `onClose`. Вертикальный свайп (скролл внутри дерева)
 * не срабатывает — сравниваем |dx| и |dy|.
 *
 * Мышью управлять не пытаемся — свайп только на touch-устройствах.
 */
export function useSwipeToCloseDrawer(
  active: boolean,
  onClose: () => void,
  { threshold = 60, direction = 'right' }: Options = {},
): void {
  useEffect(() => {
    if (!active) return undefined;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };
    const onEnd = (e: TouchEvent): void => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) <= Math.abs(dy)) return; // это скролл, не свайп
      if (direction === 'right' && dx > threshold) onClose();
      else if (direction === 'left' && dx < -threshold) onClose();
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [active, onClose, threshold, direction]);
}
