/**
 * Módulo «Uso y costos»: consumo de tokens, costo estimado y proyección.
 *
 * Todo se deriva del registro de llamadas: al corregir una tarifa en el
 * catálogo, el histórico completo se recalcula solo.
 */
import { TriangleAlert, Trash2 } from 'lucide-react';

import { Boton, Dato, Insignia, Llamado, Tabla, Tarjeta, Td, Th, Vacio } from '../brand/ui';
import { definicionDe } from '../domain/artefactos';
import {
  excedePresupuesto,
  porDia,
  porModelo,
  porTipo,
  proyeccionMensual,
  resumir,
} from '../domain/uso';
import { exportarCSV } from '../lib/exportar';
import { useEstado } from '../store';

const dolares = (v: number) => `US$ ${v.toFixed(4)}`;
const miles = (v: number) => v.toLocaleString('es-CO');

export function PanelUso() {
  const { config, llamadas, limpiarUso } = useEstado();

  if (llamadas.length === 0) {
    return (
      <Vacio titulo="Todavía no hay consumo registrado">
        Genere un artefacto en el módulo <strong>Estudio</strong> y el consumo aparecerá aquí.
      </Vacio>
    );
  }

  const total = resumir(llamadas);
  const proyeccion = proyeccionMensual(llamadas);
  const excedido = excedePresupuesto(total, config.presupuesto);

  function exportar() {
    exportarCSV(
      [
        ['Momento', 'Sesión', 'Artefacto', 'Modelo', 'Entrada', 'Salida', 'ms', 'Éxito'],
        ...llamadas.map((l) => [
          l.momento,
          l.sesionId,
          l.tipo,
          l.modelo,
          l.tokensEntrada,
          l.tokensSalida,
          l.duracionMs,
          l.exito ? 'Sí' : 'No',
        ]),
      ],
      'uso',
    );
  }

  return (
    <div className="space-y-6">
      <Llamado tono="alerta" titulo="El costo es una estimación">
        <p>
          Se calcula con las tarifas del catálogo, que <strong>no están confirmadas</strong>, y con
          el uso que reporta la API; cuando la API no lo reporta, se estima por longitud del texto.
          Para un valor exacto, consulte la facturación de MiniMax.
        </p>
      </Llamado>

      {excedido && (
        <Llamado
          tono="riesgo"
          titulo="Se superó el presupuesto fijado"
          icono={<TriangleAlert size={18} />}
        >
          <p>
            El consumo acumulado ({dolares(total.costo.total)}) supera el presupuesto de US${' '}
            {config.presupuesto.toFixed(2)} configurado en Ajustes.
          </p>
        </Llamado>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Dato rotulo="Costo acumulado" valor={dolares(total.costo.total)} tono="marca" />
        <Dato
          rotulo="Tokens consumidos"
          valor={miles(total.tokensTotales)}
          detalle={`${miles(total.tokensEntrada)} entrada · ${miles(total.tokensSalida)} salida`}
        />
        <Dato
          rotulo="Llamadas"
          valor={String(total.llamadas)}
          detalle={total.fallidas > 0 ? `${total.fallidas} fallidas` : 'todas con éxito'}
          tono={total.fallidas > 0 ? 'alerta' : 'ok'}
        />
        <Dato
          rotulo="Proyección a 30 días"
          valor={proyeccion === null ? '—' : dolares(proyeccion)}
          detalle="Según el promedio diario observado"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Consumo por modelo">
          <Tabla>
            <thead>
              <tr>
                <Th>Modelo</Th>
                <Th numerico>Llamadas</Th>
                <Th numerico>Tokens</Th>
                <Th numerico>Costo</Th>
              </tr>
            </thead>
            <tbody>
              {porModelo(llamadas).map(({ modelo, resumen }) => (
                <tr key={modelo}>
                  <Td>
                    <Insignia tono="marca">{modelo}</Insignia>
                  </Td>
                  <Td numerico>{resumen.llamadas}</Td>
                  <Td numerico>{miles(resumen.tokensTotales)}</Td>
                  <Td numerico className="font-medium">
                    {dolares(resumen.costo.total)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </Tarjeta>

        <Tarjeta titulo="Consumo por artefacto">
          <Tabla>
            <thead>
              <tr>
                <Th>Artefacto</Th>
                <Th numerico>Llamadas</Th>
                <Th numerico>Tokens</Th>
                <Th numerico>Costo</Th>
              </tr>
            </thead>
            <tbody>
              {porTipo(llamadas).map(({ tipo, resumen }) => (
                <tr key={tipo}>
                  <Td>{definicionDe(tipo).rotulo}</Td>
                  <Td numerico>{resumen.llamadas}</Td>
                  <Td numerico>{miles(resumen.tokensTotales)}</Td>
                  <Td numerico className="font-medium">
                    {dolares(resumen.costo.total)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </Tarjeta>
      </div>

      <Tarjeta
        titulo="Evolución diaria"
        descripcion="Consumo por día, en orden cronológico."
        acciones={
          <>
            <Boton variante="secundario" tamano="sm" onClick={exportar}>
              Exportar CSV
            </Boton>
            <Boton variante="peligro" tamano="sm" onClick={limpiarUso}>
              <Trash2 size={14} /> Limpiar registro
            </Boton>
          </>
        }
      >
        <Tabla>
          <thead>
            <tr>
              <Th>Día</Th>
              <Th numerico>Llamadas</Th>
              <Th numerico>Entrada</Th>
              <Th numerico>Salida</Th>
              <Th numerico>Duración media</Th>
              <Th numerico>Costo</Th>
            </tr>
          </thead>
          <tbody>
            {porDia(llamadas).map(({ dia, resumen }) => (
              <tr key={dia}>
                <Td className="font-mono text-xs">{dia}</Td>
                <Td numerico>{resumen.llamadas}</Td>
                <Td numerico>{miles(resumen.tokensEntrada)}</Td>
                <Td numerico>{miles(resumen.tokensSalida)}</Td>
                <Td numerico>{(resumen.duracionMedia / 1000).toFixed(1)} s</Td>
                <Td numerico className="font-medium">
                  {dolares(resumen.costo.total)}
                </Td>
              </tr>
            ))}
            <tr className="bg-superficie-2">
              <Td className="font-display font-semibold">Total</Td>
              <Td numerico className="font-semibold">
                {total.llamadas}
              </Td>
              <Td numerico className="font-semibold">
                {miles(total.tokensEntrada)}
              </Td>
              <Td numerico className="font-semibold">
                {miles(total.tokensSalida)}
              </Td>
              <Td numerico>{(total.duracionMedia / 1000).toFixed(1)} s</Td>
              <Td numerico className="font-semibold">
                {dolares(total.costo.total)}
              </Td>
            </tr>
          </tbody>
        </Tabla>
      </Tarjeta>
    </div>
  );
}
