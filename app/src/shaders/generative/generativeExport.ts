import type { ShaderPaint } from '../types.ts'
import { generativeFragmentShader, generativeUniforms } from './generativeFragment.ts'

export function exportGenerativeReact(paint: Extract<ShaderPaint, { kind: 'generative-material' }>): string {
  const uniforms = generativeUniforms(paint)
  const p = paint.params
  const componentName = `${(p.preset ?? 'generative').replace(/(?:^|-)([a-z])/g, (_, g) => g.toUpperCase())}Material`

  return `import React, { useRef, useEffect } from 'react';
import { ShaderMount } from '@paper-design/shaders-react';
import type { PaperShaderElement } from '@paper-design/shaders-react';

const fragmentShader = \`${generativeFragmentShader}\`;

const initialUniforms = ${JSON.stringify(uniforms, null, 2)};

export default function ${componentName}({
  speed = ${paint.speed},
  animated = ${paint.animated},
  className = '',
  style = {},
}: {
  speed?: number;
  animated?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<PaperShaderElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      ref.current?.paperShaderMount?.setUniforms({
        u_mouse: [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))],
        u_mouseActive: 1.0,
      });
    };

    const handlePointerLeave = () => {
      ref.current?.paperShaderMount?.setUniforms({ u_mouseActive: 0.0 });
    };

    el.addEventListener('pointermove', handlePointerMove, { passive: true });
    el.addEventListener('pointerleave', handlePointerLeave, { passive: true });

    return () => {
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        mixBlendMode: '${paint.composite?.blendMode ?? 'normal'}',
        opacity: ${paint.composite?.opacity ?? 1},
        ...style,
      }}
    >
      <ShaderMount
        ref={ref}
        fragmentShader={fragmentShader}
        uniforms={initialUniforms}
        speed={animated ? speed : 0}
        frame={${paint.frame}}
        minPixelRatio={1}
        maxPixelCount={1500000}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
}
`
}

export function exportGenerativeGLSL(): string {
  return generativeFragmentShader
}
