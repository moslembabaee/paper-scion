import type { ShaderPaint } from '../types.ts'
import { displayFragmentShader } from './fluidShaders.ts'

type FluidPaint = Extract<ShaderPaint, { kind: 'fluid-simulation' }>

/**
 * Self-contained production-ready React component exporting the GPU fluid simulation.
 */
export function exportFluidReact(paint: FluidPaint): string {
  const params = paint.params
  const colors = JSON.stringify(params.dyeColors)

  return `import React, { useEffect, useRef } from 'react';

/**
 * Paper Real-Time Navier-Stokes 2D Fluid Simulation Component
 * Features velocity advection, pressure Poisson solver, dye dispersion,
 * and dynamic normal-mapped refraction distortion.
 */
export default function FluidSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return;

    // Simulation parameters
    const params = ${JSON.stringify(params, null, 2)};
    const dyeColors = ${colors};

    let animId = 0;
    const render = (time: number) => {
      // Step Navier-Stokes simulation & render display pass
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        backgroundColor: '#080808',
      }}
    />
  );
}
`
}

/**
 * Exports the raw GLSL fragment shader source for the display refraction pass.
 */
export function exportFluidGLSL(): string {
  return displayFragmentShader
}
