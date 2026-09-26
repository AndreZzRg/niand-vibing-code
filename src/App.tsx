import { useState, type JSX } from 'react';

import { Portada } from './brand/Portada';
import { APP, MODULOS, Shell, type ModuloId, type Vista } from './brand/Shell';
import { PanelAjustes } from './features/PanelAjustes';
import { PanelArtefactos } from './features/PanelArtefactos';
import { PanelEstudio } from './features/PanelEstudio';
import { PanelHistorial } from './features/PanelHistorial';
import { PanelUso } from './features/PanelUso';

const PANELES: Record<ModuloId, () => JSX.Element> = {
  estudio: PanelEstudio,
  artefactos: PanelArtefactos,
  historial: PanelHistorial,
  'ajustes-y-token': PanelAjustes,
  'uso-y-costos': PanelUso,
};

export default function App() {
  // Se abre en la portada: quien llega ve primero de qué se compone la
  // herramienta, en vez de caer dentro del primer módulo sin contexto.
  const [vista, setVista] = useState<Vista>('portada');
  const Panel = vista === 'portada' ? null : PANELES[vista];

  return (
    <Shell vista={vista} onVista={setVista}>
      {Panel ? (
        <Panel />
      ) : (
        <Portada
          titulo={APP.nombre}
          descripcion={APP.resumen}
          modulos={MODULOS}
          onAbrir={(id) => setVista(id as ModuloId)}
        />
      )}
    </Shell>
  );
}
