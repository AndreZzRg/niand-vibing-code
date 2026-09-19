/**
 * Módulo «Artefactos»: lectura, copia y descarga de lo generado en la
 * sesión activa.
 */
import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';

import { Boton, Insignia, Tabla, Tarjeta, Td, Th, Vacio } from '../brand/ui';
import { ARTEFACTOS, definicionDe, type TipoArtefacto } from '../domain/artefactos';
import { exportarTexto, exportarJSON } from '../lib/exportar';
import { sesionActiva, useEstado } from '../store';

export function PanelArtefactos() {
  const estado = useEstado();
  const sesion = sesionActiva(estado);
  const [copiado, setCopiado] = useState<TipoArtefacto | null>(null);
  const [abierto, setAbierto] = useState<TipoArtefacto | null>(null);

  async function copiar(tipo: TipoArtefacto, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(tipo);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      // El portapapeles puede estar bloqueado por permisos: no es un fallo
      // de la aplicación y el usuario siempre puede descargar el artefacto.
    }
  }

  if (!sesion || sesion.artefactos.length === 0) {
    return (
      <Vacio titulo="Todavía no hay artefactos">
        Escriba una petición en el módulo <strong>Estudio</strong> y genere el primero.
      </Vacio>
    );
  }

  const ordenados = ARTEFACTOS.map((d) => sesion.artefactos.find((a) => a.tipo === d.id)).filter(
    (a): a is NonNullable<typeof a> => a !== undefined,
  );

  return (
    <div className="space-y-6">
      <Tarjeta
        titulo={sesion.titulo}
        descripcion={`${ordenados.length} de ${ARTEFACTOS.length} artefactos generados.`}
        acciones={
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={() =>
              exportarJSON(
                {
                  titulo: sesion.titulo,
                  peticion: sesion.peticion,
                  creada: sesion.creada,
                  artefactos: sesion.artefactos,
                },
                'sesion',
              )
            }
          >
            <Download size={14} /> Exportar sesión
          </Boton>
        }
      >
        <Tabla>
          <thead>
            <tr>
              <Th>Artefacto</Th>
              <Th>Modelo</Th>
              <Th numerico>Tamaño</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {ordenados.map((a) => {
              const d = definicionDe(a.tipo);
              return (
                <tr key={a.tipo}>
                  <Td>
                    <span className="font-medium">{d.rotulo}</span>
                    <span className="block text-xs text-texto-3">{d.descripcion}</span>
                  </Td>
                  <Td>
                    <Insignia tono="marca">{a.modelo}</Insignia>
                  </Td>
                  <Td numerico>{a.contenido.length.toLocaleString('es-CO')} car.</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        onClick={() => setAbierto(abierto === a.tipo ? null : a.tipo)}
                      >
                        {abierto === a.tipo ? 'Ocultar' : 'Ver'}
                      </Boton>
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        aria-label={`Copiar ${d.rotulo}`}
                        onClick={() => void copiar(a.tipo, a.contenido)}
                      >
                        {copiado === a.tipo ? <Check size={14} /> : <Copy size={14} />}
                      </Boton>
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        aria-label={`Descargar ${d.rotulo}`}
                        onClick={() => exportarTexto(a.contenido, a.tipo, d.extension)}
                      >
                        <Download size={14} />
                      </Boton>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabla>
      </Tarjeta>

      {ordenados
        .filter((a) => a.tipo === abierto)
        .map((a) => (
          <Tarjeta
            key={a.tipo}
            titulo={definicionDe(a.tipo).rotulo}
            descripcion={`Generado con ${a.modelo}.`}
          >
            <pre className="max-h-[32rem] overflow-auto rounded-xl border border-borde bg-superficie-2 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {a.contenido}
            </pre>
          </Tarjeta>
        ))}
    </div>
  );
}
