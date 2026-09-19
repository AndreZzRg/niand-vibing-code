/**
 * Artefactos de proyecto y construcción de los mensajes que los producen.
 *
 * Cada artefacto tiene su propia instrucción de sistema porque pedir «haz
 * todo» en un solo mensaje produce respuestas largas y vagas. Separarlos
 * permite además regenerar solo la pieza que quedó mal, sin pagar de nuevo
 * por las otras.
 */

export type TipoArtefacto = 'especificacion' | 'plan' | 'codigo' | 'pruebas';

export interface DefinicionArtefacto {
  readonly id: TipoArtefacto;
  readonly rotulo: string;
  readonly descripcion: string;
  /** Extensión con que se descarga el artefacto. */
  readonly extension: string;
  readonly sistema: string;
}

const COMUN =
  'Responde en español de Colombia, con precisión y sin relleno. ' +
  'No repitas la petición del usuario ni anuncies lo que vas a hacer: entrega el contenido. ' +
  'Si la petición es ambigua, elige la interpretación más razonable y anota el supuesto al final.';

export const ARTEFACTOS: readonly DefinicionArtefacto[] = [
  {
    id: 'especificacion',
    rotulo: 'Especificación',
    descripcion: 'Qué debe hacer el sistema, con criterios de aceptación verificables.',
    extension: 'md',
    sistema:
      `${COMUN} Escribe una especificación funcional en Markdown con esta estructura: ` +
      'objetivo, alcance, fuera de alcance, actores, requisitos funcionales numerados, ' +
      'requisitos no funcionales y criterios de aceptación redactados de forma verificable. ' +
      'No propongas todavía una solución técnica.',
  },
  {
    id: 'plan',
    rotulo: 'Plan de implementación',
    descripcion: 'Cómo se construye: arquitectura, pasos y riesgos.',
    extension: 'md',
    sistema:
      `${COMUN} Escribe un plan de implementación en Markdown: arquitectura propuesta y por qué, ` +
      'modelo de datos, pasos de construcción en orden de dependencia, riesgos con su mitigación ' +
      'y criterios para dar por terminado. Sé concreto con nombres de módulos y archivos.',
  },
  {
    id: 'codigo',
    rotulo: 'Código',
    descripcion: 'La implementación, en bloques de código listos para copiar.',
    extension: 'ts',
    sistema:
      `${COMUN} Entrega la implementación en bloques de código con el lenguaje indicado en la valla. ` +
      'Antes de cada bloque, una línea con la ruta del archivo. Código completo y ejecutable, ' +
      'sin fragmentos elididos ni «...». Comenta solo lo que no se deduce del código.',
  },
  {
    id: 'pruebas',
    rotulo: 'Pruebas',
    descripcion: 'Casos que demuestran que la implementación cumple la especificación.',
    extension: 'ts',
    sistema:
      `${COMUN} Escribe pruebas automatizadas que verifiquen los criterios de aceptación. ` +
      'Cada prueba debe nombrar el supuesto que verifica, no el detalle de implementación. ' +
      'Incluye los casos límite y los de error, no solo el camino feliz.',
  },
] as const;

export function definicionDe(tipo: TipoArtefacto): DefinicionArtefacto {
  const d = ARTEFACTOS.find((a) => a.id === tipo);
  if (!d) throw new RangeError(`Tipo de artefacto desconocido: "${tipo}"`);
  return d;
}

/* ── Mensajes de la conversación ──────────────────────────────────── */

export type Rol = 'system' | 'user' | 'assistant';

export interface Mensaje {
  readonly role: Rol;
  readonly content: string;
}

export interface ContextoPeticion {
  /** Descripción del proyecto en lenguaje natural. */
  readonly peticion: string;
  /** Artefactos ya generados, para dar contexto al siguiente. */
  readonly previos: ReadonlyArray<{ readonly tipo: TipoArtefacto; readonly contenido: string }>;
}

/**
 * Arma los mensajes de una petición. Los artefactos previos se incluyen
 * como contexto para que el plan siga a la especificación y las pruebas
 * sigan al código, en lugar de contradecirse entre sí.
 */
export function construirMensajes(tipo: TipoArtefacto, ctx: ContextoPeticion): readonly Mensaje[] {
  const definicion = definicionDe(tipo);
  const mensajes: Mensaje[] = [{ role: 'system', content: definicion.sistema }];

  const contexto = ctx.previos
    .filter((p) => p.tipo !== tipo && p.contenido.trim() !== '')
    .map((p) => `## ${definicionDe(p.tipo).rotulo} ya acordada\n\n${p.contenido}`)
    .join('\n\n---\n\n');

  const cuerpo = contexto
    ? `${contexto}\n\n---\n\n## Petición\n\n${ctx.peticion}`
    : `## Petición\n\n${ctx.peticion}`;

  mensajes.push({ role: 'user', content: cuerpo });
  return mensajes;
}

/** Texto completo que se envía, para estimar tokens antes de llamar. */
export function textoDeMensajes(mensajes: readonly Mensaje[]): string {
  return mensajes.map((m) => m.content).join('\n');
}
