'use client';

import React, { useEffect, useState } from 'react';
import styles from './WASDButtons.module.css';

interface WASDButtonsProps {
  onDirectionChange: (keys: {
    w: boolean;
    a: boolean;
    s: boolean;
    d: boolean;
  }) => void;
}

/**
 * On-screen WASD buttons for mobile/touch screens
 * Mimics keyboard input for movement
 */
export default function WASDButtons({ onDirectionChange }: WASDButtonsProps) {
  const [keysPressed, setKeysPressed] = useState({
    w: false,
    a: false,
    s: false,
    d: false,
  });

  // Notify parent whenever keys change
  useEffect(() => {
    onDirectionChange(keysPressed);
  }, [keysPressed, onDirectionChange]);

  const handleMouseDown = (key: 'w' | 'a' | 's' | 'd') => {
    setKeysPressed((prev) => ({ ...prev, [key]: true }));
  };

  const handleMouseUp = (key: 'w' | 'a' | 's' | 'd') => {
    setKeysPressed((prev) => ({ ...prev, [key]: false }));
  };

  return (
    <div className={styles.wasdContainer}>
      <div className={styles.wasdGrid}>
        {/* W button */}
        <button
          className={`${styles.wasdButton} ${styles.w} ${keysPressed.w ? styles.active : ''}`}
          onMouseDown={() => handleMouseDown('w')}
          onMouseUp={() => handleMouseUp('w')}
          onMouseLeave={() => handleMouseUp('w')}
          onTouchStart={() => handleMouseDown('w')}
          onTouchEnd={() => handleMouseUp('w')}
        >
          W
        </button>

        {/* A button */}
        <button
          className={`${styles.wasdButton} ${styles.a} ${keysPressed.a ? styles.active : ''}`}
          onMouseDown={() => handleMouseDown('a')}
          onMouseUp={() => handleMouseUp('a')}
          onMouseLeave={() => handleMouseUp('a')}
          onTouchStart={() => handleMouseDown('a')}
          onTouchEnd={() => handleMouseUp('a')}
        >
          A
        </button>

        {/* S button */}
        <button
          className={`${styles.wasdButton} ${styles.s} ${keysPressed.s ? styles.active : ''}`}
          onMouseDown={() => handleMouseDown('s')}
          onMouseUp={() => handleMouseUp('s')}
          onMouseLeave={() => handleMouseUp('s')}
          onTouchStart={() => handleMouseDown('s')}
          onTouchEnd={() => handleMouseUp('s')}
        >
          S
        </button>

        {/* D button */}
        <button
          className={`${styles.wasdButton} ${styles.d} ${keysPressed.d ? styles.active : ''}`}
          onMouseDown={() => handleMouseDown('d')}
          onMouseUp={() => handleMouseUp('d')}
          onMouseLeave={() => handleMouseUp('d')}
          onTouchStart={() => handleMouseDown('d')}
          onTouchEnd={() => handleMouseUp('d')}
        >
          D
        </button>
      </div>
    </div>
  );
}
