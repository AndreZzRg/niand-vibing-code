/**
 * Cada prueba nombra el supuesto que verifica, no el detalle de
 * implementación. Las del cliente ejercitan el troceado del streaming sin
 * red: un stream real llega partido en trozos arbitrarios y ese es
 * justamente el caso que rompe los analizadores ingenuos.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  MODELOS,
  MODELO_POR_DEFECTO,
  costoDe,
  estimarTokens,
  modeloDe,
  razonSeleccion,
  resolverModelo,
} from './modelos';
import {
  ARTEFACTOS,
  construirMensajes,
  definicionDe,
  textoDeMensajes,
  type TipoArtefacto,
} from './artefactos';
import {
  ErrorMiniMax,
  cuerpoDePeticion,
  fragmentoDeLinea,
  generar,
  mensajeDeError,
  urlDeChat,
  usoDeLinea,
} from './minimax';
import {
  excedePresupuesto,
  porDia,
  porModelo,
  porTipo,
  proyeccionMensual,
  resumir,
  type Llamada,
} from './uso';

/* ════════════════════════════════════════════════════════════════
   Catálogo de modelos
   ════════════════════════════════════════════════════════════════ */

describe('catálogo de modelos', () => {
  it('ninguna tarifa se declara verificada', () => {
    // Las tarifas de un proveedor no son norma: deben confirmarse a mano.
    for (const m of MODELOS) {
      expect(m.verificado).toBe(false);
    }
  });

  it('todos los modelos declaran contexto y tarifas no negativas', () => {
    for (const m of MODELOS) {
      expect(m.contexto).toBeGreaterThan(0);
      expect(m.precioEntrada).toBeGreaterThanOrEqual(0);
      expect(m.precioSalida).toBeGreaterThanOrEqual(0);
    }
  });

  it('un identificador desconocido cae en el modelo por defecto', () => {
    expect(modeloDe('inexistente').id).toBe(MODELO_POR_DEFECTO);
    expect(modeloDe(MODELO_POR_DEFECTO).id).toBe(MODELO_POR_DEFECTO);
  });
});

describe('selección automática de modelo', () => {
  it('usa el modelo preferido cuando la petición cabe con holgura', () => {
    expect(resolverModelo('auto', 1_000).id).toBe(MODELO_POR_DEFECTO);
  });

  it('pasa al de contexto largo cuando supera el 80 % de la ventana', () => {
    const preferido = modeloDe(MODELO_POR_DEFECTO);
    const elegido = resolverModelo('auto', preferido.contexto);
    expect(elegido.contexto).toBeGreaterThan(preferido.contexto);
  });

  it('respeta el modelo fijado a mano', () => {
    expect(resolverModelo('MiniMax-Text-01', 10).id).toBe('MiniMax-Text-01');
  });

  it('explica el motivo de la selección', () => {
    expect(razonSeleccion('auto', 10)).toContain('cabe con holgura');
    expect(razonSeleccion('auto', 10_000_000)).toContain('excede');
    expect(razonSeleccion('MiniMax-M2', 10)).toContain('manualmente');
  });
});

describe('costo y estimación', () => {
  const modelo = modeloDe(MODELO_POR_DEFECTO);

  it('cobra por millón de tokens y separa entrada de salida', () => {
    const c = costoDe(modelo, 1_000_000, 1_000_000);
    expect(c.entrada).toBeCloseTo(modelo.precioEntrada, 10);
    expect(c.salida).toBeCloseTo(modelo.precioSalida, 10);
    expect(c.total).toBeCloseTo(modelo.precioEntrada + modelo.precioSalida, 10);
  });

  it('no cobra por tokens negativos', () => {
    expect(costoDe(modelo, -100, -100).total).toBe(0);
  });

  it('el costo es cero sin consumo', () => {
    expect(costoDe(modelo, 0, 0).total).toBe(0);
  });

  it('estima alrededor de cuatro caracteres por token', () => {
    expect(estimarTokens('')).toBe(0);
    expect(estimarTokens('abcd')).toBe(1);
    expect(estimarTokens('a'.repeat(400))).toBe(100);
  });
});

/* ════════════════════════════════════════════════════════════════
   Artefactos y construcción de mensajes
   ════════════════════════════════════════════════════════════════ */

describe('definición de artefactos', () => {
  it('cubre los cuatro artefactos del flujo', () => {
    expect(ARTEFACTOS).toHaveLength(4);
    const ids = ARTEFACTOS.map((a) => a.id);
    expect(ids).toEqual(['especificacion', 'plan', 'codigo', 'pruebas']);
  });

  it('cada uno declara instrucción de sistema y extensión', () => {
    for (const a of ARTEFACTOS) {
      expect(a.sistema.length).toBeGreaterThan(50);
      expect(a.extension).toMatch(/^[a-z]+$/);
    }
  });

  it('rechaza un tipo desconocido', () => {
    expect(() => definicionDe('inventado' as TipoArtefacto)).toThrow(RangeError);
  });
});

describe('construcción de mensajes', () => {
  it('antepone la instrucción de sistema del artefacto pedido', () => {
    const m = construirMensajes('especificacion', { peticion: 'Un carrito', previos: [] });
    expect(m[0]?.role).toBe('system');
    expect(m[0]?.content).toBe(definicionDe('especificacion').sistema);
    expect(m[1]?.role).toBe('user');
    expect(m[1]?.content).toContain('Un carrito');
  });

  it('incluye los artefactos previos como contexto', () => {
    const m = construirMensajes('plan', {
      peticion: 'Un carrito',
      previos: [{ tipo: 'especificacion', contenido: 'El sistema debe cobrar.' }],
    });
    expect(m[1]?.content).toContain('El sistema debe cobrar.');
    expect(m[1]?.content).toContain('Especificación ya acordada');
  });

  it('no se incluye a sí mismo como contexto', () => {
    const m = construirMensajes('plan', {
      peticion: 'Un carrito',
      previos: [{ tipo: 'plan', contenido: 'PLAN VIEJO' }],
    });
    expect(m[1]?.content).not.toContain('PLAN VIEJO');
  });

  it('ignora los artefactos previos vacíos', () => {
    const m = construirMensajes('plan', {
      peticion: 'Un carrito',
      previos: [{ tipo: 'especificacion', contenido: '   ' }],
    });
    expect(m[1]?.content).not.toContain('ya acordada');
  });

  it('el texto de los mensajes sirve para estimar tokens', () => {
    const m = construirMensajes('codigo', { peticion: 'Hola', previos: [] });
    expect(estimarTokens(textoDeMensajes(m))).toBeGreaterThan(0);
  });
});

/* ════════════════════════════════════════════════════════════════
   Cliente de MiniMax
   ════════════════════════════════════════════════════════════════ */

describe('construcción de la petición', () => {
  it('compone la URL sin duplicar la barra final', () => {
    expect(urlDeChat('https://api.minimax.io/v1')).toBe(
      'https://api.minimax.io/v1/text/chatcompletion_v2',
    );
    expect(urlDeChat('https://api.minimax.io/v1/')).toBe(
      'https://api.minimax.io/v1/text/chatcompletion_v2',
    );
  });

  it('pide streaming y traslada los parámetros del modelo', () => {
    const cuerpo = JSON.parse(
      cuerpoDePeticion({
        baseURL: 'x',
        token: 't',
        modelo: 'MiniMax-M2',
        mensajes: [{ role: 'user', content: 'hola' }],
        temperatura: 0.3,
        maxTokens: 1000,
      }),
    ) as Record<string, unknown>;

    expect(cuerpo.stream).toBe(true);
    expect(cuerpo.model).toBe('MiniMax-M2');
    expect(cuerpo.temperature).toBe(0.3);
    expect(cuerpo.max_tokens).toBe(1000);
  });

  it('el cuerpo nunca lleva el token', () => {
    const cuerpo = cuerpoDePeticion({
      baseURL: 'x',
      token: 'SECRETO-123',
      modelo: 'm',
      mensajes: [],
      temperatura: 0,
      maxTokens: 1,
    });
    expect(cuerpo).not.toContain('SECRETO-123');
  });
});

describe('mensajes de error', () => {
  it('traduce los estados más frecuentes sin tecnicismos', () => {
    expect(mensajeDeError(401, '')).toContain('token no es válido');
    expect(mensajeDeError(403, '')).toContain('permiso');
    expect(mensajeDeError(429, '')).toContain('límite');
    expect(mensajeDeError(500, '')).toContain('no está disponible');
  });

  it('recorta el cuerpo largo en vez de volcarlo entero', () => {
    const mensaje = mensajeDeError(400, 'x'.repeat(500));
    expect(mensaje.length).toBeLessThan(300);
    expect(mensaje).toContain('…');
  });
});

describe('troceado del streaming', () => {
  it('extrae el contenido de un delta', () => {
    const linea = 'data: {"choices":[{"delta":{"content":"hola"}}]}';
    expect(fragmentoDeLinea(linea)).toBe('hola');
  });

  it('acepta también la forma con message', () => {
    const linea = 'data: {"choices":[{"message":{"content":"hola"}}]}';
    expect(fragmentoDeLinea(linea)).toBe('hola');
  });

  it('ignora líneas vacías, comentarios y la marca final', () => {
    expect(fragmentoDeLinea('')).toBeNull();
    expect(fragmentoDeLinea(': keep-alive')).toBeNull();
    expect(fragmentoDeLinea('data: [DONE]')).toBeNull();
    expect(fragmentoDeLinea('event: message')).toBeNull();
  });

  it('ignora el JSON partido a la mitad en vez de fallar', () => {
    expect(fragmentoDeLinea('data: {"choices":[{"delta":{"cont')).toBeNull();
  });

  it('lee el uso cuando la API lo reporta', () => {
    const linea = 'data: {"usage":{"prompt_tokens":120,"completion_tokens":300}}';
    expect(usoDeLinea(linea)).toEqual({ tokensEntrada: 120, tokensSalida: 300 });
  });

  it('devuelve nulo cuando la línea no trae uso', () => {
    expect(usoDeLinea('data: {"choices":[]}')).toBeNull();
    expect(usoDeLinea('data: [DONE]')).toBeNull();
    expect(usoDeLinea('otra cosa')).toBeNull();
  });
});

/** Respuesta simulada que entrega el cuerpo en los trozos indicados. */
function respuestaStream(trozos: readonly string[]): Response {
  const codificador = new TextEncoder();
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controlador) {
      for (const t of trozos) controlador.enqueue(codificador.encode(t));
      controlador.close();
    },
  });
  return new Response(cuerpo, { status: 200 });
}

describe('generación', () => {
  const base = {
    baseURL: 'https://api.minimax.io/v1',
    token: 'token-de-prueba',
    modelo: 'MiniMax-M2',
    mensajes: [{ role: 'user' as const, content: 'hola' }],
    temperatura: 0.3,
    maxTokens: 100,
  };

  it('exige el token antes de salir a la red', async () => {
    const fetchFalso = vi.fn();
    await expect(generar({ ...base, token: '  ', fetch: fetchFalso })).rejects.toThrow(
      ErrorMiniMax,
    );
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('envía el token en la cabecera Authorization', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaStream(['data: [DONE]\n']));
    await generar({ ...base, fetch: fetchFalso });

    const opciones = fetchFalso.mock.calls[0]?.[1] as RequestInit;
    const cabeceras = opciones.headers as Record<string, string>;
    expect(cabeceras.Authorization).toBe('Bearer token-de-prueba');
  });

  it('concatena los fragmentos en el orden recibido', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(
        respuestaStream([
          'data: {"choices":[{"delta":{"content":"Hola"}}]}\n',
          'data: {"choices":[{"delta":{"content":" mundo"}}]}\n',
          'data: [DONE]\n',
        ]),
      );

    const r = await generar({ ...base, fetch: fetchFalso });
    expect(r.contenido).toBe('Hola mundo');
  });

  it('reensambla un fragmento partido entre dos lecturas', async () => {
    // El caso que rompe a los analizadores que asumen líneas completas.
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(
        respuestaStream([
          'data: {"choices":[{"delta":{"con',
          'tent":"entero"}}]}\n',
          'data: [DONE]\n',
        ]),
      );

    const r = await generar({ ...base, fetch: fetchFalso });
    expect(r.contenido).toBe('entero');
  });

  it('procesa la última línea aunque no termine en salto', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuestaStream(['data: {"choices":[{"delta":{"content":"final"}}]}']));

    const r = await generar({ ...base, fetch: fetchFalso });
    expect(r.contenido).toBe('final');
  });

  it('avisa de cada fragmento por la devolución de llamada', async () => {
    const recibidos: string[] = [];
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(
        respuestaStream([
          'data: {"choices":[{"delta":{"content":"a"}}]}\n',
          'data: {"choices":[{"delta":{"content":"b"}}]}\n',
        ]),
      );

    await generar({ ...base, fetch: fetchFalso, alRecibir: (f) => recibidos.push(f) });
    expect(recibidos).toEqual(['a', 'b']);
  });

  it('recoge el uso reportado por la API', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(
        respuestaStream([
          'data: {"choices":[{"delta":{"content":"x"}}]}\n',
          'data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}\n',
          'data: [DONE]\n',
        ]),
      );

    const r = await generar({ ...base, fetch: fetchFalso });
    expect(r.uso).toEqual({ tokensEntrada: 10, tokensSalida: 20 });
  });

  it('deja el uso en cero cuando la API no lo reporta', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuestaStream(['data: {"choices":[{"delta":{"content":"x"}}]}\n']));

    const r = await generar({ ...base, fetch: fetchFalso });
    expect(r.uso).toEqual({ tokensEntrada: 0, tokensSalida: 0 });
  });

  it('traduce el error de la API sin filtrar el token', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(new Response('token-de-prueba inválido', { status: 401 }));

    await expect(generar({ ...base, fetch: fetchFalso })).rejects.toThrow(/token no es válido/);
  });

  it('convierte un fallo de red en un error legible', async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(generar({ ...base, fetch: fetchFalso })).rejects.toThrow(/No se pudo contactar/);
  });

  it('propaga la cancelación del usuario tal cual', async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError'));

    await expect(generar({ ...base, fetch: fetchFalso })).rejects.toThrow(DOMException);
  });
});

/* ════════════════════════════════════════════════════════════════
   Uso y costos
   ════════════════════════════════════════════════════════════════ */

const llamada = (p: Partial<Llamada> & Pick<Llamada, 'id'>): Llamada => ({
  momento: '2026-03-05T10:00:00.000Z',
  sesionId: 's1',
  tipo: 'especificacion',
  modelo: 'MiniMax-M2',
  tokensEntrada: 1_000,
  tokensSalida: 2_000,
  duracionMs: 4_000,
  exito: true,
  ...p,
});

describe('resumen de uso', () => {
  it('está vacío sin llamadas', () => {
    const r = resumir([]);
    expect(r.llamadas).toBe(0);
    expect(r.costo.total).toBe(0);
    expect(r.duracionMedia).toBe(0);
  });

  it('suma tokens y costo de todas las llamadas', () => {
    const r = resumir([llamada({ id: 'a' }), llamada({ id: 'b' })]);
    expect(r.llamadas).toBe(2);
    expect(r.tokensEntrada).toBe(2_000);
    expect(r.tokensSalida).toBe(4_000);
    expect(r.tokensTotales).toBe(6_000);
    expect(r.costo.total).toBeGreaterThan(0);
  });

  it('cuenta las fallidas y las excluye de la duración media', () => {
    const r = resumir([
      llamada({ id: 'a', duracionMs: 2_000 }),
      llamada({ id: 'b', exito: false, duracionMs: 90_000 }),
    ]);
    expect(r.fallidas).toBe(1);
    expect(r.duracionMedia).toBe(2_000);
  });

  it('una llamada fallida no anula su consumo de tokens', () => {
    // Una petición que falló a mitad de camino igual consumió entrada.
    const r = resumir([llamada({ id: 'a', exito: false })]);
    expect(r.tokensEntrada).toBe(1_000);
  });
});

describe('desgloses', () => {
  const llamadas = [
    llamada({ id: 'a', modelo: 'MiniMax-M2', tipo: 'especificacion' }),
    llamada({ id: 'b', modelo: 'MiniMax-Text-01', tipo: 'plan' }),
    llamada({ id: 'c', modelo: 'MiniMax-M2', tipo: 'plan' }),
  ];

  it('agrupa por modelo y ordena por costo descendente', () => {
    const grupos = porModelo(llamadas);
    expect(grupos).toHaveLength(2);
    expect(grupos[0]?.resumen.costo.total).toBeGreaterThanOrEqual(
      grupos[1]?.resumen.costo.total ?? 0,
    );
  });

  it('agrupa por tipo de artefacto', () => {
    const grupos = porTipo(llamadas);
    expect(grupos).toHaveLength(2);
    expect(grupos.reduce((s, g) => s + g.resumen.llamadas, 0)).toBe(3);
  });

  it('agrupa por día en orden cronológico', () => {
    const grupos = porDia([
      llamada({ id: 'a', momento: '2026-03-06T10:00:00.000Z' }),
      llamada({ id: 'b', momento: '2026-03-05T10:00:00.000Z' }),
    ]);
    expect(grupos.map((g) => g.dia)).toEqual(['2026-03-05', '2026-03-06']);
  });
});

describe('proyección y presupuesto', () => {
  it('no proyecta sin datos', () => {
    expect(proyeccionMensual([])).toBeNull();
  });

  it('proyecta el gasto de treinta días a partir del promedio diario', () => {
    const uno = resumir([llamada({ id: 'a' })]).costo.total;
    expect(proyeccionMensual([llamada({ id: 'a' })])).toBeCloseTo(uno * 30, 10);
  });

  it('avisa solo cuando hay presupuesto fijado y se supera', () => {
    const r = resumir([llamada({ id: 'a' })]);
    expect(excedePresupuesto(r, 0)).toBe(false);
    expect(excedePresupuesto(r, 1_000)).toBe(false);
    expect(excedePresupuesto(r, 0.000_001)).toBe(true);
  });
});
