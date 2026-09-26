/**
 * Cada prueba nombra el supuesto que verifica, no el detalle de
 * implementación. Las del cliente ejercitan el troceado del streaming sin
 * red: un stream real llega partido en trozos arbitrarios y ese es
 * justamente el caso que rompe los analizadores ingenuos.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  MODELOS,
  PREFERIDO,
  costoDe,
  estimarTokens,
  modeloDe,
  modelosDe,
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
  ErrorIA,
  PROVEEDORES,
  cabecerasDe,
  cuerpoDePeticion,
  esProveedor,
  fragmentoDeLinea,
  generar,
  mensajeDeError,
  urlDeChat,
  usoDeLinea,
} from './ia';
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

  it('cada proveedor aporta al menos un modelo y un preferido válido', () => {
    for (const p of ['minimax', 'gemini'] as const) {
      const suyos = modelosDe(p);
      expect(suyos.length).toBeGreaterThan(0);
      expect(suyos.every((m) => m.proveedor === p)).toBe(true);
      expect(suyos.some((m) => m.id === PREFERIDO[p])).toBe(true);
    }
  });

  it('un identificador desconocido cae en el preferido de su proveedor', () => {
    expect(modeloDe('inexistente', 'gemini').id).toBe(PREFERIDO.gemini);
    expect(modeloDe('inexistente', 'minimax').id).toBe(PREFERIDO.minimax);
  });

  it('no devuelve un modelo de otro proveedor', () => {
    // Pedir un modelo de MiniMax estando en Gemini debe caer en Gemini, no
    // colarse: la llamada se haría contra una API que no lo conoce.
    expect(modeloDe('MiniMax-M2', 'gemini').proveedor).toBe('gemini');
  });
});

describe('selección automática de modelo', () => {
  it('usa el preferido del proveedor cuando la petición cabe con holgura', () => {
    expect(resolverModelo('auto', 1_000, 'minimax').id).toBe(PREFERIDO.minimax);
    expect(resolverModelo('auto', 1_000, 'gemini').id).toBe(PREFERIDO.gemini);
  });

  it('pasa al de contexto más largo del mismo proveedor al superar el 80 %', () => {
    const preferido = modeloDe(PREFERIDO.minimax, 'minimax');
    const elegido = resolverModelo('auto', preferido.contexto, 'minimax');
    expect(elegido.contexto).toBeGreaterThan(preferido.contexto);
    expect(elegido.proveedor).toBe('minimax');
  });

  it('respeta el modelo fijado a mano', () => {
    expect(resolverModelo('MiniMax-Text-01', 10, 'minimax').id).toBe('MiniMax-Text-01');
  });

  it('explica el motivo de la selección', () => {
    expect(razonSeleccion('auto', 10, 'minimax')).toContain('cabe con holgura');
    expect(razonSeleccion('auto', 10_000_000, 'minimax')).toContain('excede');
    expect(razonSeleccion('MiniMax-M2', 10, 'minimax')).toContain('manualmente');
  });
});

describe('costo y estimación', () => {
  const modelo = modeloDe(PREFERIDO.minimax, 'minimax');

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
   Cliente de modelos: dos proveedores, un solo contrato
   ════════════════════════════════════════════════════════════════ */

describe('identificación del proveedor', () => {
  it('reconoce solo los proveedores soportados', () => {
    expect(esProveedor('minimax')).toBe(true);
    expect(esProveedor('gemini')).toBe(true);
    expect(esProveedor('openai')).toBe(false);
    expect(esProveedor(undefined)).toBe(false);
  });

  it('cada ficha declara consola y variable de entorno', () => {
    for (const p of ['minimax', 'gemini'] as const) {
      expect(PROVEEDORES[p].consola).toMatch(/^https:\/\//);
      expect(PROVEEDORES[p].variableEntorno).toMatch(/^VITE_/);
    }
  });
});

describe('ruta de la petición', () => {
  it('compone la de MiniMax sin duplicar la barra final', () => {
    expect(urlDeChat('minimax', 'https://api.minimax.io/v1', 'M2')).toBe(
      'https://api.minimax.io/v1/text/chatcompletion_v2',
    );
    expect(urlDeChat('minimax', 'https://api.minimax.io/v1/', 'M2')).toBe(
      'https://api.minimax.io/v1/text/chatcompletion_v2',
    );
  });

  it('la de Gemini lleva el modelo en la ruta y pide eventos de servidor', () => {
    const u = urlDeChat('gemini', 'https://generativelanguage.googleapis.com/v1beta', 'g-2.5');
    expect(u).toContain('/models/g-2.5:streamGenerateContent');
    // Sin `alt=sse` Gemini responde un arreglo que solo se lee al final.
    expect(u).toContain('alt=sse');
  });

  it('la ruta se compone solo de la base y el modelo', () => {
    // `urlDeChat` no recibe el token, así que no puede filtrarlo. El
    // invariante se verifica de verdad sobre la llamada completa, en
    // «el token nunca viaja en la URL».
    expect(urlDeChat('gemini', 'https://x/v1', 'g-2.5')).toBe(
      'https://x/v1/models/g-2.5:streamGenerateContent?alt=sse',
    );
  });
});

describe('cabeceras de autenticación', () => {
  it('MiniMax usa Bearer y Gemini su cabecera propia', () => {
    expect(cabecerasDe('minimax', 'tk')['Authorization']).toBe('Bearer tk');
    expect(cabecerasDe('gemini', 'tk')['x-goog-api-key']).toBe('tk');
  });

  it('Gemini no recibe cabecera Authorization, que ignoraría', () => {
    expect(cabecerasDe('gemini', 'tk')['Authorization']).toBeUndefined();
  });
});

describe('cuerpo de la petición', () => {
  const mensajes = [
    { role: 'system' as const, content: 'Eres preciso.' },
    { role: 'user' as const, content: 'hola' },
  ];
  const comun = { modelo: 'm', mensajes, temperatura: 0.3, maxTokens: 1000 };

  it('MiniMax pide streaming y manda los mensajes tal cual', () => {
    const c = JSON.parse(cuerpoDePeticion({ ...comun, proveedor: 'minimax' })) as Record<
      string,
      unknown
    >;
    expect(c.stream).toBe(true);
    expect(c.temperature).toBe(0.3);
    expect(c.max_tokens).toBe(1000);
    expect((c.messages as unknown[]).length).toBe(2);
  });

  it('Gemini separa la instrucción de sistema del resto', () => {
    const c = JSON.parse(cuerpoDePeticion({ ...comun, proveedor: 'gemini' })) as {
      systemInstruction?: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      generationConfig: Record<string, number>;
    };
    expect(c.systemInstruction?.parts[0]?.text).toBe('Eres preciso.');
    // El sistema ya no viaja dentro de `contents`.
    expect(c.contents).toHaveLength(1);
    expect(c.contents[0]?.role).toBe('user');
    expect(c.generationConfig.temperature).toBe(0.3);
    expect(c.generationConfig.maxOutputTokens).toBe(1000);
  });

  it('Gemini llama «model» al papel del asistente', () => {
    const c = JSON.parse(
      cuerpoDePeticion({
        ...comun,
        proveedor: 'gemini',
        mensajes: [{ role: 'assistant', content: 'ya respondí' }],
      }),
    ) as { contents: Array<{ role: string }> };
    expect(c.contents[0]?.role).toBe('model');
  });

  it('ningún cuerpo lleva el token', () => {
    for (const p of ['minimax', 'gemini'] as const) {
      expect(cuerpoDePeticion({ ...comun, proveedor: p })).not.toContain('SECRETO');
    }
  });
});

describe('mensajes de error', () => {
  it('traduce los estados más frecuentes y nombra al proveedor', () => {
    expect(mensajeDeError(401, '', 'minimax')).toContain('MiniMax');
    expect(mensajeDeError(401, '', 'gemini')).toContain('Gemini');
    expect(mensajeDeError(401, '', 'gemini')).toContain('no es válido');
    expect(mensajeDeError(403, '', 'minimax')).toContain('permiso');
    expect(mensajeDeError(404, '', 'gemini')).toContain('no reconoce el modelo');
    expect(mensajeDeError(429, '', 'minimax')).toContain('límite');
    expect(mensajeDeError(500, '', 'minimax')).toContain('no está disponible');
  });

  it('recorta el cuerpo largo en vez de volcarlo entero', () => {
    const m = mensajeDeError(400, 'x'.repeat(500), 'minimax');
    expect(m.length).toBeLessThan(300);
    expect(m).toContain('…');
  });
});

describe('troceado del flujo', () => {
  it('extrae el contenido de un delta de MiniMax', () => {
    expect(fragmentoDeLinea('minimax', 'data: {"choices":[{"delta":{"content":"hola"}}]}')).toBe(
      'hola',
    );
  });

  it('extrae el contenido de una parte de Gemini', () => {
    const l = 'data: {"candidates":[{"content":{"parts":[{"text":"hola"}]}}]}';
    expect(fragmentoDeLinea('gemini', l)).toBe('hola');
  });

  it('une varias partes de un mismo fragmento de Gemini', () => {
    const l = 'data: {"candidates":[{"content":{"parts":[{"text":"ho"},{"text":"la"}]}}]}';
    expect(fragmentoDeLinea('gemini', l)).toBe('hola');
  });

  it('ignora líneas vacías, comentarios y la marca final', () => {
    for (const p of ['minimax', 'gemini'] as const) {
      expect(fragmentoDeLinea(p, '')).toBeNull();
      expect(fragmentoDeLinea(p, ': keep-alive')).toBeNull();
      expect(fragmentoDeLinea(p, 'data: [DONE]')).toBeNull();
      expect(fragmentoDeLinea(p, 'event: message')).toBeNull();
    }
  });

  it('ignora el JSON partido a la mitad en vez de fallar', () => {
    expect(fragmentoDeLinea('minimax', 'data: {"choices":[{"delta":{"cont')).toBeNull();
    expect(fragmentoDeLinea('gemini', 'data: {"candidates":[{"cont')).toBeNull();
  });

  it('lee el uso que reporta cada proveedor, con su propio nombre de campo', () => {
    expect(
      usoDeLinea('minimax', 'data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}'),
    ).toEqual({ tokensEntrada: 10, tokensSalida: 20 });
    expect(
      usoDeLinea(
        'gemini',
        'data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":20}}',
      ),
    ).toEqual({ tokensEntrada: 10, tokensSalida: 20 });
  });

  it('devuelve nulo cuando la línea no trae uso', () => {
    expect(usoDeLinea('minimax', 'data: {"choices":[]}')).toBeNull();
    expect(usoDeLinea('gemini', 'data: {"candidates":[]}')).toBeNull();
    expect(usoDeLinea('minimax', 'otra cosa')).toBeNull();
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
    proveedor: 'minimax' as const,
    baseURL: 'https://api.minimax.io/v1',
    token: 'token-de-prueba',
    modelo: 'MiniMax-M2',
    mensajes: [{ role: 'user' as const, content: 'hola' }],
    temperatura: 0.3,
    maxTokens: 100,
  };

  it('exige el token antes de salir a la red', async () => {
    const fetchFalso = vi.fn();
    await expect(generar({ ...base, token: '  ', fetch: fetchFalso })).rejects.toThrow(ErrorIA);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('envía el token en la cabecera que corresponde a cada proveedor', async () => {
    for (const [proveedor, cabecera] of [
      ['minimax', 'Authorization'],
      ['gemini', 'x-goog-api-key'],
    ] as const) {
      const fetchFalso = vi.fn().mockResolvedValue(respuestaStream(['data: [DONE]\n']));
      await generar({ ...base, proveedor, fetch: fetchFalso });

      const opciones = fetchFalso.mock.calls[0]?.[1] as RequestInit;
      const cabeceras = opciones.headers as Record<string, string>;
      expect(cabeceras[cabecera]).toContain('token-de-prueba');
    }
  });

  it('el token nunca viaja en la URL, en ningún proveedor', async () => {
    // En la barra de direcciones quedaría en el historial, en los registros
    // de cualquier intermediario y en el encabezado `Referer`.
    for (const proveedor of ['minimax', 'gemini'] as const) {
      const fetchFalso = vi.fn().mockResolvedValue(respuestaStream(['data: [DONE]\n']));
      await generar({ ...base, proveedor, fetch: fetchFalso });

      const url = String(fetchFalso.mock.calls[0]?.[0]);
      expect(url).not.toContain('token-de-prueba');
      expect(url).not.toContain('key=');
    }
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
    expect(r.proveedor).toBe('minimax');
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
    expect((await generar({ ...base, fetch: fetchFalso })).contenido).toBe('entero');
  });

  it('también reensambla el flujo de Gemini partido entre lecturas', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(
        respuestaStream(['data: {"candidates":[{"content":{"parts":[{"text":"en', 'tero"}]}}]}\n']),
      );
    const r = await generar({ ...base, proveedor: 'gemini', fetch: fetchFalso });
    expect(r.contenido).toBe('entero');
    expect(r.proveedor).toBe('gemini');
  });

  it('procesa la última línea aunque no termine en salto', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuestaStream(['data: {"choices":[{"delta":{"content":"final"}}]}']));
    expect((await generar({ ...base, fetch: fetchFalso })).contenido).toBe('final');
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
    await generar({ ...base, fetch: fetchFalso, alRecibir: (f: string) => recibidos.push(f) });
    expect(recibidos).toEqual(['a', 'b']);
  });

  it('recoge el uso reportado por cada proveedor', async () => {
    const minimax = vi
      .fn()
      .mockResolvedValue(
        respuestaStream(['data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}\n']),
      );
    expect((await generar({ ...base, fetch: minimax })).uso).toEqual({
      tokensEntrada: 10,
      tokensSalida: 20,
    });

    const gemini = vi
      .fn()
      .mockResolvedValue(
        respuestaStream([
          'data: {"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":9}}\n',
        ]),
      );
    expect((await generar({ ...base, proveedor: 'gemini', fetch: gemini })).uso).toEqual({
      tokensEntrada: 7,
      tokensSalida: 9,
    });
  });

  it('deja el uso en cero cuando la API no lo reporta', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuestaStream(['data: {"choices":[{"delta":{"content":"x"}}]}\n']));
    expect((await generar({ ...base, fetch: fetchFalso })).uso).toEqual({
      tokensEntrada: 0,
      tokensSalida: 0,
    });
  });

  it('traduce el error de la API sin filtrar el token', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(new Response('token-de-prueba inválido', { status: 401 }));
    await expect(generar({ ...base, fetch: fetchFalso })).rejects.toThrow(/no es válido/);
    await expect(generar({ ...base, fetch: fetchFalso })).rejects.not.toThrow(/token-de-prueba/);
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
  proveedor: 'minimax',
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
