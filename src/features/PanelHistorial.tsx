/**
 * Módulo «Historial»: sesiones anteriores, con su consumo y el estado de
 * sus artefactos. Todo vive en el navegador; nada se sube a ningún lado.
 */
import { CheckCircle2, FolderOpen, Trash2 } from 'lucide-react';

import { Boton, Dato, Insignia, Tabla, Tarjeta, Td, Th, Vacio } from '../brand/ui';
import { ARTEFACTOS } from '../domain/artefactos';
import { resumir } from '../domain/uso';
import { exportarJSON } from '../lib/exportar';
import { useEstado } from '../store';

function fechaLegible(iso: string): string {
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return iso;
  return f.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PanelHistorial() {
  const { sesiones, sesionActivaId, llamadas, activarSesion, borrarSesion } = useEstado();

  if (sesiones.length === 0) {
    return (
      <Vacio titulo="El historial está vacío">
        Las sesiones que cree en el módulo <strong>Estudio</strong> aparecerán aquí.
      </Vacio>
    );
  }

  const total = resumir(llamadas);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Dato rotulo="Sesiones" valor={String(sesiones.length)} tono="marca" />
        <Dato rotulo="Llamadas registradas" valor={String(total.llamadas)} />
        <Dato
          rotulo="Artefactos generados"
          valor={String(sesiones.reduce((s, x) => s + x.artefactos.length, 0))}
        />
      </div>

      <Tarjeta
        titulo="Sesiones"
        descripcion="Abra una para seguir trabajando sobre sus artefactos."
        acciones={
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={() => exportarJSON({ sesiones, llamadas }, 'historial')}
          >
            Exportar historial
          </Boton>
        }
      >
        <Tabla>
          <thead>
            <tr>
              <Th>Sesión</Th>
              <Th>Creada</Th>
              <Th>Artefactos</Th>
              <Th numerico>Llamadas</Th>
              <Th numerico>Costo</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {sesiones.map((s) => {
              const suyas = llamadas.filter((l) => l.sesionId === s.id);
              const r = resumir(suyas);
              const activa = s.id === sesionActivaId;

              return (
                <tr key={s.id} className={activa ? 'bg-superficie-2' : undefined}>
                  <Td>
                    <span className="font-medium">{s.titulo}</span>
                    {activa && (
                      <Insignia tono="ok" className="ml-2">
                        Activa
                      </Insignia>
                    )}
                  </Td>
                  <Td className="text-xs">{fechaLegible(s.creada)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {ARTEFACTOS.map((a) => {
                        const hecho = s.artefactos.some((x) => x.tipo === a.id);
                        return (
                          <Insignia key={a.id} tono={hecho ? 'ok' : 'neutro'}>
                            {hecho && <CheckCircle2 size={11} />}
                            {a.rotulo}
                          </Insignia>
                        );
                      })}
                    </div>
                  </Td>
                  <Td numerico>{r.llamadas}</Td>
                  <Td numerico className="font-medium">
                    {r.costo.total > 0 ? `US$ ${r.costo.total.toFixed(4)}` : '—'}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        aria-label={`Abrir ${s.titulo}`}
                        onClick={() => activarSesion(s.id)}
                        disabled={activa}
                      >
                        <FolderOpen size={14} />
                      </Boton>
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        aria-label={`Eliminar ${s.titulo}`}
                        onClick={() => borrarSesion(s.id)}
                      >
                        <Trash2 size={14} />
                      </Boton>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabla>
      </Tarjeta>
    </div>
  );
}
