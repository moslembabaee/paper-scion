import type { ShaderPaint } from '../types.ts'
import { extrusionFragmentShader, extrusionUniforms, extrusionVertexShader } from './extrusionShaders.ts'
import type { VectorExtrusionParams } from './types.ts'

export function exportExtrusionReact(paint: Extract<ShaderPaint, { kind: 'vector-extrusion' }>): string {
  const p = paint.params as VectorExtrusionParams
  const uniforms = extrusionUniforms(p, 512, 512, false, 0, 16)
  const style = {
    width: '100%',
    height: '100%',
    opacity: paint.composite?.opacity ?? 1,
    mixBlendMode: paint.composite?.blendMode ?? 'normal',
  }

  return `import { useEffect, useRef } from 'react';

// WebGL 3D Vector Extrusion & Directional Shadow Lighting Engine
const vertexShaderSource = \`${extrusionVertexShader}\`;
const fragmentShaderSource = \`${extrusionFragmentShader}\`;
const extrusionUniforms = ${JSON.stringify(uniforms, null, 2)};

export default function VectorExtrusion3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'high-performance' });
    if (!gl) return;

    const createShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const vs = createShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Set uniforms
    for (const [key, val] of Object.entries(extrusionUniforms)) {
      const loc = gl.getUniformLocation(program, key);
      if (loc === null) continue;
      if (typeof val === 'number') gl.uniform1f(loc, val);
      else if (Array.isArray(val)) {
        if (val.length === 2) gl.uniform2f(loc, val[0], val[1]);
        else if (val.length === 3) gl.uniform3f(loc, val[0], val[1], val[2]);
      }
    }

    let req = 0;
    const render = () => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ${paint.animated ? 'req = requestAnimationFrame(render);' : ''}
    };
    render();

    return () => {
      if (req) cancelAnimationFrame(req);
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    };
  }, []);

  return (
    <div style={${JSON.stringify(style)}}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
`
}
