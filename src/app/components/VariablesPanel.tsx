import type { VariableView } from '@core/index';

interface VariablesPanelProps {
  variables: VariableView[];
}

export function VariablesPanel({ variables }: VariablesPanelProps) {
  return (
    <div className="panel">
      <div className="panel__title">Переменные</div>
      <div className="panel__body">
        {variables.length === 0 ? (
          <span className="panel__hint">Нет переменных.</span>
        ) : (
          <table className="vars">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Тип</th>
                <th>Значение</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((v) => (
                <tr key={v.name}>
                  <td className="vars__name">{v.name}</td>
                  <td className="vars__type">{v.type}</td>
                  <td className="vars__value">{v.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
