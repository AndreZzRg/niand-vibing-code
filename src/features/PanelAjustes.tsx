/**
 * Módulo «Ajustes y token».
 *
 * El token se trata aparte del resto del estado: se guarda bajo su propia
 * clave, no entra en ninguna exportación y nunca se muestra completo. Un
 * token que aparece en un JSON compartido es un token comprometido.
 */
import { useState } from 'react';
import { Eye, EyeOff, KeyRound, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';

import {
  Boton,
  Campo,
  Entrada,
  Insignia,
  Llamado,
  Seleccion,
  Tabla,
  Tarjeta,
  Td,
  Th,
} from '../brand/ui';
import { MODELOS } from '../domain/modelos';
import { guardarToken, leerToken, olvidarToken, tokenDelEntorno, useEstado } from '../store';

/** Muestra solo los extremos: suficiente para reconocerlo, inútil si se filtra. */
export function enmascarar(token: string): string {
  if (token.length <= 8) return '••••••••';
  return `${token.slice(0, 4)}${'•'.repeat(12)}${token.slice(-4)}`;
}

export function PanelAjustes() {
  const { config, setConfig, reiniciar } = useEstado();

  const delEntorno = tokenDelEntorno();
  const [token, setToken] = useState(delEntorno ? '' : leerToken());
  const [visible, setVisible] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const actual = leerToken();

  function guardar() {
    guardarToken(token);
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2000);
  }

  function olvidar() {
    olvidarToken();
    setToken('');
  }

  return (
    <div className="space-y-6">
      <Tarjeta
        titulo="Token de MiniMax"
        descripcion="Queda únicamente en el almacenamiento local de este navegador."
        acciones={
          actual ? (
            <Insignia tono="ok">
              <ShieldCheck size={11} /> Configurado
            </Insignia>
          ) : (
            <Insignia tono="riesgo">Sin token</Insignia>
          )
        }
      >
        {delEntorno ? (
          <Llamado tono="info" titulo="El token viene del entorno" icono={<KeyRound size={18} />}>
            <p>
              Está definido en <span className="font-mono text-xs">VITE_MINIMAX_API_KEY</span> y
              tiene prioridad sobre el que se guarde aquí. Para cambiarlo, edite su archivo{' '}
              <span className="font-mono text-xs">.env</span> y reinicie el servidor de desarrollo.
            </p>
            <p className="mt-2">
              Token en uso: <span className="font-mono text-xs">{enmascarar(actual)}</span>
            </p>
          </Llamado>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Campo
                etiqueta="Token"
                ayuda="Obténgalo en minimax.io/platform → API Keys. No se versiona nunca."
              >
                {(id) => (
                  <Entrada
                    id={id}
                    type={visible ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="eyJhbGciOi…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                )}
              </Campo>
              <div className="flex items-end gap-2">
                <Boton
                  variante="secundario"
                  aria-label={visible ? 'Ocultar el token' : 'Mostrar el token'}
                  onClick={() => setVisible((v) => !v)}
                >
                  {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </Boton>
                <Boton onClick={guardar} disabled={!token.trim()}>
                  <Save size={16} /> {guardado ? 'Guardado' : 'Guardar'}
                </Boton>
              </div>
            </div>

            {actual && (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-texto-2">
                <span>
                  Token guardado: <span className="font-mono text-xs">{enmascarar(actual)}</span>
                </span>
                <Boton variante="peligro" tamano="sm" onClick={olvidar}>
                  <Trash2 size={14} /> Olvidar token
                </Boton>
              </div>
            )}
          </>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Parámetros de generación"
        descripcion="Afectan al costo y a la estabilidad de las respuestas."
        acciones={
          <Boton variante="fantasma" tamano="sm" onClick={reiniciar}>
            <RotateCcw size={14} /> Reiniciar
          </Boton>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Modelo" ayuda="«Automático» elige según el tamaño de la petición.">
            {(id) => (
              <Seleccion
                id={id}
                value={config.modelo}
                onChange={(e) => setConfig({ modelo: e.target.value })}
              >
                <option value="auto">Automático</option>
                {MODELOS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.rotulo}
                  </option>
                ))}
              </Seleccion>
            )}
          </Campo>

          <Campo etiqueta="Temperatura" ayuda="Menor es más determinista; 0,3 va bien para código.">
            {(id) => (
              <Entrada
                id={id}
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={config.temperatura}
                onChange={(e) => setConfig({ temperatura: Number(e.target.value) })}
              />
            )}
          </Campo>

          <Campo etiqueta="Máximo de tokens de salida">
            {(id) => (
              <Entrada
                id={id}
                type="number"
                min={256}
                max={64_000}
                step={256}
                value={config.maxTokens}
                onChange={(e) => setConfig({ maxTokens: Number(e.target.value) })}
              />
            )}
          </Campo>

          <Campo etiqueta="Presupuesto mensual (US$)" ayuda="Cero desactiva el aviso.">
            {(id) => (
              <Entrada
                id={id}
                type="number"
                min={0}
                step={1}
                value={config.presupuesto}
                onChange={(e) => setConfig({ presupuesto: Number(e.target.value) })}
              />
            )}
          </Campo>

          <Campo etiqueta="URL base de la API" ayuda="Cámbiela solo si usa una pasarela propia.">
            {(id) => (
              <Entrada
                id={id}
                value={config.baseURL}
                onChange={(e) => setConfig({ baseURL: e.target.value })}
              />
            )}
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Tarifas del catálogo"
        descripcion="Ninguna está confirmada: contrástelas con la página de precios de MiniMax."
      >
        <Llamado tono="alerta" className="mb-4">
          <p>
            Las tarifas de un proveedor cambian sin aviso y no son una norma. Las que aparecen aquí
            sirven para dar un orden de magnitud; <strong>no las use para facturar</strong> sin
            confirmarlas.
          </p>
        </Llamado>

        <Tabla>
          <thead>
            <tr>
              <Th>Modelo</Th>
              <Th numerico>Contexto</Th>
              <Th numerico>Entrada (US$/M)</Th>
              <Th numerico>Salida (US$/M)</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {MODELOS.map((m) => (
              <tr key={m.id}>
                <Td>
                  <span className="font-medium">{m.rotulo}</span>
                  <span className="block text-xs text-texto-3">{m.descripcion}</span>
                </Td>
                <Td numerico>{m.contexto.toLocaleString('es-CO')}</Td>
                <Td numerico>{m.precioEntrada.toFixed(2)}</Td>
                <Td numerico>{m.precioSalida.toFixed(2)}</Td>
                <Td>
                  <Insignia tono={m.verificado ? 'ok' : 'alerta'}>
                    {m.verificado ? 'Confirmada' : 'Sin confirmar'}
                  </Insignia>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Tarjeta>
    </div>
  );
}
