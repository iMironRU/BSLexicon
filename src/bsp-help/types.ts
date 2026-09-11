/**
 * Контракт JSON `public/reference/bsp-hooks.json` — что кладёт скрипт
 * `scripts/build-bsp-hooks.ts` и что читает UI /help/bsp/.
 */
export interface BspParam {
  name: string;
  type: string;
  description: string;
}

export interface BspProcedure {
  name: string;
  kind: 'Процедура' | 'Функция';
  signature: string;
  params: BspParam[];
  exportFlag: boolean;
  docstring: string;
}

export interface BspModule {
  name: string;
  side: 'Клиент' | 'Сервер';
  procedures: BspProcedure[];
}

export interface BspSubsystem {
  name: string;
  ways: string[];
  modules: BspModule[];
}

export interface BspHooksJson {
  bspVersion: string;
  license: {
    spdx: string;
    url: string;
    holder: string;
  };
  generatedAt: string;
  subsystems: BspSubsystem[];
}
