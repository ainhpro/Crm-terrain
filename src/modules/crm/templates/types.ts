/** Modèles de pipelines : étapes identifiées par leur code, libellés en FR et NL. */

export interface StepTemplate {
  code: string;
  label: { fr: string; nl: string };
  /** Libellé court affiché sous le point du pipeline. */
  short: { fr: string; nl: string };
}

export interface PipelineTemplate {
  code: string;
  /** Absent : pipeline commun à tous les clients. */
  groupCode?: string;
  label: { fr: string; nl: string };
  steps: StepTemplate[];
  impliedByDefault?: string[];
}

export interface GroupTemplate {
  code: string;
  name: string;
  color: string;
  sites: string[];
}
