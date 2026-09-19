import { useState, type JSX } from 'react';

import { Shell, type ModuloId } from './brand/Shell';
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
  const [modulo, setModulo] = useState<ModuloId>('estudio');
  const Panel = PANELES[modulo];

  return (
    <Shell moduloActivo={modulo} onModulo={setModulo}>
      <Panel />
    </Shell>
  );
}
