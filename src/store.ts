/**
 * Estado de la aplicación. Persiste en `localStorage` bajo el prefijo del
 * repositorio; nada viaja a un servidor propio.
 *
 * El token es la excepción a la regla de «todo se persiste»: se guarda
 * aparte, bajo su propia clave, y queda fuera del volcado de diagnóstico y
 * de cualquier exportación. Un token dentro de un JSON que el usuario
 * comparte por correo es un token comprometido.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { almacenZustand, borrar, leer, escribir } from './lib/almacen';
import type { TipoArtefacto } from './domain/artefactos';
import type { Llamada } from './domain/uso';
import { MODELO_POR_DEFECTO } from './domain/modelos';
import { z } from 'zod';

/* ── Token: guardado aparte y nunca exportado ─────────────────────── */

const CLAVE_TOKEN = 'token';
const VERSION_TOKEN = 1;

export function leerToken(): string {
  // La variable de entorno tiene prioridad: permite usar la aplicación sin
  // pegar el token en el navegador.
  const delEntorno = import.meta.env.VITE_MINIMAX_API_KEY;
  if (typeof delEntorno === 'string' && delEntorno.trim()) return delEntorno.trim();
  return leer(CLAVE_TOKEN, z.string(), VERSION_TOKEN, '');
}

export function guardarToken(token: string): boolean {
  return escribir(CLAVE_TOKEN, VERSION_TOKEN, token.trim());
}

export function olvidarToken(): void {
  borrar(CLAVE_TOKEN);
}

/** `true` cuando el token viene del entorno y no se puede editar aquí. */
export function tokenDelEntorno(): boolean {
  const v = import.meta.env.VITE_MINIMAX_API_KEY;
  return typeof v === 'string' && v.trim() !== '';
}

/* ── Sesiones y artefactos ────────────────────────────────────────── */

export interface Artefacto {
  readonly tipo: TipoArtefacto;
  contenido: string;
  /** Marca de tiempo ISO de la última generación. */
  generado: string;
  modelo: string;
}

export interface Sesion {
  readonly id: string;
  titulo: string;
  peticion: string;
  /** Marca de tiempo ISO de creación. */
  creada: string;
  artefactos: Artefacto[];
}

export interface Configuracion {
  baseURL: string;
  /** `auto` deja que el dominio elija el modelo por tamaño de la petición. */
  modelo: string;
  temperatura: number;
  maxTokens: number;
  /** Presupuesto mensual en dólares; cero desactiva el aviso. */
  presupuesto: number;
}

export interface Estado {
  config: Configuracion;
  sesiones: Sesion[];
  sesionActivaId: string;
  llamadas: Llamada[];

  setConfig: (p: Partial<Configuracion>) => void;

  nuevaSesion: (peticion: string) => string;
  activarSesion: (id: string) => void;
  renombrarSesion: (id: string, titulo: string) => void;
  borrarSesion: (id: string) => void;
  actualizarPeticion: (id: string, peticion: string) => void;
  guardarArtefacto: (sesionId: string, a: Artefacto) => void;

  registrarLlamada: (l: Llamada) => void;
  limpiarUso: () => void;

  reiniciar: () => void;
}

/** Identificador estable sin depender de `crypto.randomUUID`. */
export function nuevoId(prefijo = 'id'): string {
  return `${prefijo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Título corto derivado de la petición, para la lista del historial. */
export function tituloDesde(peticion: string): string {
  const limpia = peticion.trim().replace(/\s+/g, ' ');
  if (!limpia) return 'Sesión sin título';
  return limpia.length > 60 ? `${limpia.slice(0, 57)}…` : limpia;
}

const BASE_URL_POR_DEFECTO =
  (typeof import.meta.env.VITE_MINIMAX_BASE_URL === 'string' &&
    import.meta.env.VITE_MINIMAX_BASE_URL) ||
  'https://api.minimax.io/v1';

const MODELO_INICIAL =
  (typeof import.meta.env.VITE_MINIMAX_MODEL === 'string' && import.meta.env.VITE_MINIMAX_MODEL) ||
  'auto';

const INICIAL = {
  config: {
    baseURL: BASE_URL_POR_DEFECTO,
    modelo: MODELO_INICIAL || 'auto',
    temperatura: 0.3,
    maxTokens: 8192,
    presupuesto: 0,
  } satisfies Configuracion,
  sesiones: [] as Sesion[],
  sesionActivaId: '',
  llamadas: [] as Llamada[],
};

export const useEstado = create<Estado>()(
  persist(
    (set) => ({
      ...structuredClone(INICIAL),

      setConfig: (p) => set((s) => ({ config: { ...s.config, ...p } })),

      nuevaSesion: (peticion) => {
        const id = nuevoId('ses');
        const sesion: Sesion = {
          id,
          titulo: tituloDesde(peticion),
          peticion,
          creada: new Date().toISOString(),
          artefactos: [],
        };
        set((s) => ({ sesiones: [sesion, ...s.sesiones], sesionActivaId: id }));
        return id;
      },

      activarSesion: (id) => set({ sesionActivaId: id }),

      renombrarSesion: (id, titulo) =>
        set((s) => ({
          sesiones: s.sesiones.map((x) => (x.id === id ? { ...x, titulo } : x)),
        })),

      borrarSesion: (id) =>
        set((s) => {
          const sesiones = s.sesiones.filter((x) => x.id !== id);
          return {
            sesiones,
            sesionActivaId: s.sesionActivaId === id ? (sesiones[0]?.id ?? '') : s.sesionActivaId,
            llamadas: s.llamadas.filter((l) => l.sesionId !== id),
          };
        }),

      actualizarPeticion: (id, peticion) =>
        set((s) => ({
          sesiones: s.sesiones.map((x) =>
            x.id === id ? { ...x, peticion, titulo: x.titulo || tituloDesde(peticion) } : x,
          ),
        })),

      guardarArtefacto: (sesionId, a) =>
        set((s) => ({
          sesiones: s.sesiones.map((x) => {
            if (x.id !== sesionId) return x;
            const otros = x.artefactos.filter((y) => y.tipo !== a.tipo);
            return { ...x, artefactos: [...otros, a] };
          }),
        })),

      registrarLlamada: (l) => set((s) => ({ llamadas: [...s.llamadas, l] })),

      limpiarUso: () => set({ llamadas: [] }),

      // El token no forma parte del estado: se borra aparte con `olvidarToken`.
      reiniciar: () => set(structuredClone(INICIAL)),
    }),
    {
      name: 'estado',
      version: 1,
      storage: createJSONStorage(() => almacenZustand),
      // El token nunca entra aquí: vive bajo su propia clave.
      partialize: (s) => ({
        config: s.config,
        sesiones: s.sesiones,
        sesionActivaId: s.sesionActivaId,
        llamadas: s.llamadas,
      }),
    },
  ),
);

/** Sesión activa, o `null` si todavía no hay ninguna. */
export function sesionActiva(s: Estado): Sesion | null {
  return s.sesiones.find((x) => x.id === s.sesionActivaId) ?? s.sesiones[0] ?? null;
}

export { MODELO_POR_DEFECTO };
