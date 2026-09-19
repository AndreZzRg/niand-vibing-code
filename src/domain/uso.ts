/**
 * Contabilidad de consumo y costo de las llamadas al modelo.
 *
 * Todo se calcula a partir del registro de llamadas: no se guardan totales,
 * se derivan. Así, al corregir la tarifa de un modelo, el histórico entero
 * se recalcula y no quedan cifras viejas que contradigan a las nuevas.
 */

import { costoDe, modeloDe, type Costo } from './modelos';
import type { TipoArtefacto } from './artefactos';

export interface Llamada {
  readonly id: string;
  /** Marca de tiempo ISO completa. */
  readonly momento: string;
  readonly sesionId: string;
  readonly tipo: TipoArtefacto;
  readonly modelo: string;
  readonly tokensEntrada: number;
  readonly tokensSalida: number;
  /** Milisegundos que tardó la llamada. */
  readonly duracionMs: number;
  readonly exito: boolean;
}

export interface ResumenUso {
  readonly llamadas: number;
  readonly fallidas: number;
  readonly tokensEntrada: number;
  readonly tokensSalida: number;
  readonly tokensTotales: number;
  readonly costo: Costo;
  /** Duración media de las llamadas con éxito, en milisegundos. */
  readonly duracionMedia: number;
}

const VACIO: ResumenUso = {
  llamadas: 0,
  fallidas: 0,
  tokensEntrada: 0,
  tokensSalida: 0,
  tokensTotales: 0,
  costo: { entrada: 0, salida: 0, total: 0 },
  duracionMedia: 0,
};

export function resumir(llamadas: readonly Llamada[]): ResumenUso {
  if (llamadas.length === 0) return VACIO;

  let tokensEntrada = 0;
  let tokensSalida = 0;
  let entrada = 0;
  let salida = 0;
  let fallidas = 0;
  let duracionTotal = 0;
  let conExito = 0;

  for (const l of llamadas) {
    tokensEntrada += l.tokensEntrada;
    tokensSalida += l.tokensSalida;

    const c = costoDe(modeloDe(l.modelo), l.tokensEntrada, l.tokensSalida);
    entrada += c.entrada;
    salida += c.salida;

    if (l.exito) {
      conExito++;
      duracionTotal += l.duracionMs;
    } else {
      fallidas++;
    }
  }

  return {
    llamadas: llamadas.length,
    fallidas,
    tokensEntrada,
    tokensSalida,
    tokensTotales: tokensEntrada + tokensSalida,
    costo: { entrada, salida, total: entrada + salida },
    duracionMedia: conExito > 0 ? duracionTotal / conExito : 0,
  };
}

/** Resumen desglosado por modelo, ordenado por costo descendente. */
export function porModelo(
  llamadas: readonly Llamada[],
): ReadonlyArray<{ readonly modelo: string; readonly resumen: ResumenUso }> {
  const grupos = new Map<string, Llamada[]>();
  for (const l of llamadas) {
    const lista = grupos.get(l.modelo) ?? [];
    lista.push(l);
    grupos.set(l.modelo, lista);
  }

  return [...grupos.entries()]
    .map(([modelo, ls]) => ({ modelo, resumen: resumir(ls) }))
    .sort((a, b) => b.resumen.costo.total - a.resumen.costo.total);
}

/** Resumen desglosado por tipo de artefacto. */
export function porTipo(
  llamadas: readonly Llamada[],
): ReadonlyArray<{ readonly tipo: TipoArtefacto; readonly resumen: ResumenUso }> {
  const grupos = new Map<TipoArtefacto, Llamada[]>();
  for (const l of llamadas) {
    const lista = grupos.get(l.tipo) ?? [];
    lista.push(l);
    grupos.set(l.tipo, lista);
  }

  return [...grupos.entries()]
    .map(([tipo, ls]) => ({ tipo, resumen: resumir(ls) }))
    .sort((a, b) => b.resumen.costo.total - a.resumen.costo.total);
}

/** Consumo por día, en orden cronológico, para dibujar la evolución. */
export function porDia(
  llamadas: readonly Llamada[],
): ReadonlyArray<{ readonly dia: string; readonly resumen: ResumenUso }> {
  const grupos = new Map<string, Llamada[]>();
  for (const l of llamadas) {
    const dia = l.momento.slice(0, 10);
    const lista = grupos.get(dia) ?? [];
    lista.push(l);
    grupos.set(dia, lista);
  }

  return [...grupos.entries()]
    .map(([dia, ls]) => ({ dia, resumen: resumir(ls) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Proyección de gasto mensual a partir del consumo observado.
 * Devuelve `null` cuando no hay días suficientes para proyectar nada.
 */
export function proyeccionMensual(llamadas: readonly Llamada[]): number | null {
  const dias = porDia(llamadas);
  if (dias.length === 0) return null;

  const total = dias.reduce((s, d) => s + d.resumen.costo.total, 0);
  return (total / dias.length) * 30;
}

/** `true` si el consumo del periodo superó el presupuesto fijado. */
export function excedePresupuesto(resumen: ResumenUso, presupuesto: number): boolean {
  return presupuesto > 0 && resumen.costo.total > presupuesto;
}
