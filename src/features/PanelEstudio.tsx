/**
 * Módulo «Estudio»: convierte una descripción en lenguaje natural en los
 * artefactos del proyecto, uno a uno y con streaming.
 *
 * La generación es por artefacto y no «todo de una vez» para que se pueda
 * regenerar solo la pieza que quedó mal sin volver a pagar por las otras.
 * El trabajo impuro —reloj y red— vive en `ejecutarGeneracion`.
 */
import { useRef, useState } from 'react';
import { CircleStop, KeyRound, Play, Sparkles } from 'lucide-react';

import { AreaTexto, Boton, Campo, Dato, Insignia, Llamado, Tarjeta, Vacio } from '../brand/ui';
import {
  ARTEFACTOS,
  construirMensajes,
  textoDeMensajes,
  type TipoArtefacto,
} from '../domain/artefactos';
import { estimarTokens, razonSeleccion, resolverModelo } from '../domain/modelos';
import { leerToken, nuevoId, sesionActiva, useEstado } from '../store';
import { ejecutarGeneracion } from './ejecutar';

export function PanelEstudio() {
  const estado = useEstado();
  const { config, nuevaSesion, actualizarPeticion, guardarArtefacto, registrarLlamada } = estado;
  const sesion = sesionActiva(estado);

  const [borrador, setBorrador] = useState(sesion?.peticion ?? '');
  const [generando, setGenerando] = useState<TipoArtefacto | null>(null);
  const [parcial, setParcial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortar = useRef<AbortController | null>(null);

  const token = leerToken();
  const hayToken = token.trim() !== '';

  const peticion = borrador.trim();
  const previos = (sesion?.artefactos ?? []).map((a) => ({ tipo: a.tipo, contenido: a.contenido }));

  // Estimación mostrada sobre el artefacto de mayor contexto, para que sea
  // la del peor caso y no una que se quede corta.
  const mensajesMuestra = construirMensajes('pruebas', { peticion, previos });
  const tokensEstimados = estimarTokens(textoDeMensajes(mensajesMuestra));
  const modelo = resolverModelo(config.modelo, tokensEstimados);
  const razon = razonSeleccion(config.modelo, tokensEstimados);

  async function ejecutar(tipo: TipoArtefacto) {
    if (!peticion || !hayToken || generando) return;

    setError(null);
    setParcial('');
    setGenerando(tipo);

    // Si todavía no hay sesión, la primera petición la crea.
    const sesionId = sesion?.id ?? nuevaSesion(peticion);
    if (sesion && sesion.peticion !== peticion) actualizarPeticion(sesion.id, peticion);

    const controlador = new AbortController();
    abortar.current = controlador;

    const r = await ejecutarGeneracion({
      tipo,
      peticion,
      previos,
      config,
      token,
      sesionId,
      señal: controlador.signal,
      alRecibir: (f) => setParcial((p) => p + f),
      nuevoId,
    });

    if (r.artefacto) guardarArtefacto(sesionId, r.artefacto);
    registrarLlamada(r.llamada);
    if (r.error) setError(r.error);

    setParcial('');
    setGenerando(null);
    abortar.current = null;
  }

  return (
    <div className="space-y-6">
      {!hayToken && (
        <Llamado tono="alerta" titulo="Falta el token de MiniMax" icono={<KeyRound size={18} />}>
          <p>
            Configúrelo en <strong>Ajustes y token</strong> o defina{' '}
            <span className="font-mono text-xs">VITE_MINIMAX_API_KEY</span> en su archivo{' '}
            <span className="font-mono text-xs">.env</span>. El token queda solo en su navegador y
            nunca se versiona.
          </p>
        </Llamado>
      )}

      <Tarjeta
        titulo="Descripción del proyecto"
        descripcion="Diga qué quiere construir. Entre más concreto, menos supuestos tendrá que corregir después."
      >
        <Campo etiqueta="Petición" requerido>
          {(id) => (
            <AreaTexto
              id={id}
              className="min-h-40"
              placeholder="Una aplicación web para registrar visitas a una obra, con control de acceso por rol y reporte semanal en PDF…"
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
            />
          )}
        </Campo>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Dato
            rotulo="Tokens estimados de entrada"
            valor={tokensEstimados.toLocaleString('es-CO')}
            detalle="Aproximación por longitud, no tokenización real"
          />
          <Dato rotulo="Modelo que se usará" valor={modelo.rotulo} tono="marca" detalle={razon} />
          <Dato
            rotulo="Artefactos generados"
            valor={`${sesion?.artefactos.length ?? 0} de ${ARTEFACTOS.length}`}
          />
        </div>
      </Tarjeta>

      {error && (
        <Llamado tono="riesgo" titulo="No se pudo generar">
          <p>{error}</p>
        </Llamado>
      )}

      <Tarjeta
        titulo="Generar artefactos"
        descripcion="Cada uno usa los anteriores como contexto: genérelos en orden para que no se contradigan."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ARTEFACTOS.map((a) => {
            const ya = sesion?.artefactos.find((x) => x.tipo === a.id);
            const activo = generando === a.id;
            return (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-xl border border-borde bg-superficie-3 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-sm font-semibold">{a.rotulo}</p>
                  {ya && <Insignia tono="ok">Generado</Insignia>}
                </div>
                <p className="flex-1 text-xs text-texto-3">{a.descripcion}</p>
                <Boton
                  tamano="sm"
                  variante={ya ? 'secundario' : 'primario'}
                  onClick={() => void ejecutar(a.id)}
                  disabled={!peticion || !hayToken || generando !== null}
                >
                  {activo ? (
                    <>
                      <Sparkles size={14} /> Generando…
                    </>
                  ) : (
                    <>
                      <Play size={14} /> {ya ? 'Regenerar' : 'Generar'}
                    </>
                  )}
                </Boton>
              </div>
            );
          })}
        </div>

        {generando && (
          <div className="mt-4 flex justify-end">
            <Boton variante="peligro" tamano="sm" onClick={() => abortar.current?.abort()}>
              <CircleStop size={14} /> Detener
            </Boton>
          </div>
        )}
      </Tarjeta>

      {generando && (
        <Tarjeta
          titulo="Respuesta en curso"
          descripcion="El texto llega por fragmentos; se guarda al terminar."
        >
          {parcial ? (
            <pre className="max-h-96 overflow-auto rounded-xl border border-borde bg-superficie-2 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {parcial}
            </pre>
          ) : (
            <Vacio titulo="Esperando el primer fragmento…" />
          )}
        </Tarjeta>
      )}
    </div>
  );
}
