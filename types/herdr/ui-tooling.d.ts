export interface Component {
  id: string;
  name: string;
  label: string;
  mod: string;
  file: string;
  line: number;
  exported: boolean;
  kind: string;
  description: string;
  ids: string[];
  roles: string[];
  labels: string[];
  labelFor: Record<string, string>;
  controlIds: string[];
  tooltips: string[];
  texts: string[];
  lines: number;
  members?: number;
}

export interface Mod {
  name: string;
  description: string;
  area?: string;
  files: string[];
  tests: string[];
  pageNodes: string[];
  componentCount: number;
  shared?: string[];
  next?: string[];
}

export interface Page {
  layout: string;
  node: string;
  stack: string | null;
  mod: string | null;
  props: unknown;
}

export interface SharedHelper {
  source: string;
  outputs: string[];
}

export interface Indexed {
  schemaVersion: number;
  root: string;
  mods: Record<string, Mod>;
  components: Component[];
  ids: Record<
    string,
    {
      id: string;
      mod: string;
      file: string;
      line: number;
      component: string;
      label: string;
      role: string;
    }
  >;
  pages: Page[];
  shared: SharedHelper[];
}

export interface UiStatus {
  layout: string;
  space: string;
  tab: string;
  agent?: string;
  overlays: unknown[];
  errors: string[];
}

export interface OcrRow {
  text: string;
  x: number;
  y: number;
  confidence: number;
  width: number;
  height: number;
}
