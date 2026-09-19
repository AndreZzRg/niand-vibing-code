/**
 * Orquestación de una generación: arma los mensajes, llama al modelo,
 * guarda el artefacto y deja registrado el consumo.
 *
 * Vive fuera de los componentes a propósito. Aquí se consultan el reloj y
 * la red, que son impuros; mantenerlos fuera del cuerpo de un componente
 * deja a React libre de volver a renderizar cuando quiera.
 */

import { construirMensajes, textoDeMensajes, type TipoArtefacto } from '../domain/artefactos';
import { estimarTokens, resolverModelo } from '../domain/modelos';
import { ErrorMiniMax, generar } from '../domain/minimax';
import type { Llamada } from '../domain/uso';
import type { Artefacto, Configuracion } from '../store';

export interface PeticionGeneracion {
  readonly tipo: TipoArtefacto;
  readonly peticion: string;
  readonly previos: ReadonlyArray<{ readonly tipo: TipoArtefacto; readonly contenido: string }>;
  readonly config: Configuracion;
  readonly token: string;
  readonly sesionId: string;
  readonly señal: AbortSignal;
  readonly alRecibir: (fragmento: string) => void;
  readonly nuevoId: (prefijo: string) => string;
}

export interface ResultadoGeneracion {
  readonly artefacto: Artefacto | null;
  readonly llamada: Llamada;
  /** Mensaje para el usuario, o `null` si todo salió bien. */
  readonly error: string | null;
  /** `true` cuando el usuario canceló: no es un error que deba mostrarse. */
  readonly cancelado: boolean;
}

export async function ejecutarGeneracion(p: PeticionGeneracion): Promise<ResultadoGeneracion> {
  const mensajes = construirMensajes(p.tipo, { peticion: p.peticion, previos: p.previos });
  const tokensEntrada = estimarTokens(textoDeMensajes(mensajes));
  const modelo = resolverModelo(p.config.modelo, tokensEntrada);

  const inicio = Date.now();
  let recibido = '';

  const base = {
    id: p.nuevoId('lla'),
    sesionId: p.sesionId,
    tipo: p.tipo,
    modelo: modelo.id,
  };

  try {
    const r = await generar({
      baseURL: p.config.baseURL,
      token: p.token,
      modelo: modelo.id,
      mensajes,
      temperatura: p.config.temperatura,
      maxTokens: p.config.maxTokens,
      señal: p.señal,
      alRecibir: (f) => {
        recibido += f;
        p.alRecibir(f);
      },
    });

    return {
      artefacto: {
        tipo: p.tipo,
        contenido: r.contenido,
        generado: new Date().toISOString(),
        modelo: modelo.id,
      },
      llamada: {
        ...base,
        momento: new Date().toISOString(),
        // Si la API no reporta uso, se estima para no perder la trazabilidad
        // del consumo; el panel de costos advierte que es una estimación.
        tokensEntrada: r.uso.tokensEntrada || tokensEntrada,
        tokensSalida: r.uso.tokensSalida || estimarTokens(r.contenido),
        duracionMs: Date.now() - inicio,
        exito: true,
      },
      error: null,
      cancelado: false,
    };
  } catch (e) {
    const cancelado = e instanceof DOMException && e.name === 'AbortError';

    return {
      artefacto: null,
      llamada: {
        ...base,
        momento: new Date().toISOString(),
        tokensEntrada,
        tokensSalida: estimarTokens(recibido),
        duracionMs: Date.now() - inicio,
        exito: false,
      },
      error: cancelado
        ? null
        : e instanceof ErrorMiniMax
          ? e.message
          : 'Ocurrió un error inesperado al generar.',
      cancelado,
    };
  }
}
