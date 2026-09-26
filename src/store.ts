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
import { PROVEEDORES, type Proveedor } from './domain/ia';
import { z } from 'zod';

/* ── Token: guardado aparte y nunca exportado ─────────────────────── */

/**
 * Cada proveedor guarda su token bajo su propia clave. Cambiar de MiniMax
 * a Gemini no obliga a volver a pegar la credencial del otro, y un token
 * nunca llega a un proveedor que no es el suyo.
 */
const VERSION_TOKEN = 1;
const claveToken = (p: Proveedor) => `token:${p}`;

/** Token declarado en el entorno, si lo hay, para ese proveedor. */
function tokenDelEntornoDe(p: Proveedor): string {
  const v = import.meta.env[PROVEEDORES[p].variableEntorno] as unknown;
  return typeof v === 'string' ? v.trim() : '';
}

export function leerToken(p: Proveedor): string {
  // La variable de entorno tiene prioridad: permite usar la aplicación sin
  // pegar el token en el navegador.
  const delEntorno = tokenDelEntornoDe(p);
  if (delEntorno) return delEntorno;
  return leer(claveToken(p), z.string(), VERSION_TOKEN, '');
}

export function guardarToken(p: Proveedor, token: string): boolean {
  return escribir(claveToken(p), VERSION_TOKEN, token.trim());
}

export function olvidarToken(p: Proveedor): void {
  borrar(claveToken(p));
}

/** `true` cuando el token viene del entorno y no se puede editar aquí. */
export function tokenDelEntorno(p: Proveedor): boolean {
  return tokenDelEntornoDe(p) !== '';
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
  /** Proveedor con el que se generan los artefactos. */
  proveedor: Proveedor;
  /** URL base por proveedor: solo se cambia para usar una pasarela propia. */
  baseURL: Record<Proveedor, string>;
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

const INICIAL = {
  config: {
    proveedor: 'minimax',
    baseURL: {
      minimax: PROVEEDORES.minimax.baseURLPorDefecto,
      gemini: PROVEEDORES.gemini.baseURLPorDefecto,
    },
    modelo: 'auto',
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
