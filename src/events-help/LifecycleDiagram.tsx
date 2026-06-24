import type { LifecycleScenario, SwimlaneId } from './lifecycle';

interface LifecycleDiagramProps {
  scenario: LifecycleScenario;
  /** Href для клика по шагу — переход на карточку события. */
  hrefForEvent: (eventId: string) => string;
}

const STEP_W = 220;
const STEP_H = 56;
const STEP_GAP_X = 30;
const SWIMLANE_H = 110;
const HEADER_H = 32;
const LEFT_LABELS_W = 130;
const PAD_X = 12;
const PAD_TOP = HEADER_H + 12;
const CANCEL_H = 28;

/**
 * SVG-диаграмма сценария: горизонтальные swimlane'ы, шаги-боксы по
 * порядку с стрелками. У шага с `cancel` — побочный «выход» вниз.
 *
 * Своя реализация (без React Flow / Mermaid) — это даёт полный контроль
 * над семантикой (клик по шагу = переход к карточке события) и не
 * раздувает бандл.
 */
export function LifecycleDiagram({ scenario, hrefForEvent }: LifecycleDiagramProps) {
  const lanes = scenario.swimlanes;
  const laneIndex: Record<SwimlaneId, number> = { client: -1, server: -1, object: -1 };
  lanes.forEach((l, i) => { laneIndex[l.id] = i; });

  const stepX = (i: number): number => LEFT_LABELS_W + PAD_X + i * (STEP_W + STEP_GAP_X);
  const stepY = (lane: SwimlaneId): number =>
    PAD_TOP + laneIndex[lane] * SWIMLANE_H + (SWIMLANE_H - STEP_H) / 2;

  const totalW = LEFT_LABELS_W + PAD_X * 2 + scenario.steps.length * (STEP_W + STEP_GAP_X);
  const totalH = PAD_TOP + lanes.length * SWIMLANE_H + 30;

  return (
    <svg
      className="lifecycle-svg"
      viewBox={`0 0 ${totalW} ${totalH}`}
      width="100%"
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-label={`Диаграмма: ${scenario.title}`}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
        </marker>
        <marker
          id="arrow-cancel"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--error)" />
        </marker>
      </defs>

      {/* Swimlane-фоновые полосы и метки слева */}
      {lanes.map((lane, i) => {
        const y = PAD_TOP + i * SWIMLANE_H;
        return (
          <g key={lane.id} className={`lifecycle__lane lifecycle__lane--${lane.id}`}>
            <rect x={0} y={y} width={totalW} height={SWIMLANE_H} className="lifecycle__lane-bg" />
            <text x={10} y={y + SWIMLANE_H / 2} className="lifecycle__lane-label" dominantBaseline="middle">
              {lane.label}
            </text>
          </g>
        );
      })}

      {/* Стрелки между последовательными шагами */}
      {scenario.steps.slice(0, -1).map((step, i) => {
        const next = scenario.steps[i + 1];
        const x1 = stepX(i) + STEP_W;
        const y1 = stepY(step.swimlane) + STEP_H / 2;
        const x2 = stepX(i + 1);
        const y2 = stepY(next.swimlane) + STEP_H / 2;
        // Используем простую "Г"-образную ломаную если разный swimlane
        const mid = (x1 + x2) / 2;
        const d = step.swimlane === next.swimlane
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`;
        return (
          <path
            key={`a-${step.id}`}
            d={d}
            className="lifecycle__arrow"
            fill="none"
            markerEnd="url(#arrow)"
          />
        );
      })}

      {/* Шаги */}
      {scenario.steps.map((step, i) => {
        const x = stepX(i);
        const y = stepY(step.swimlane);
        return (
          <g key={step.id} className="lifecycle__step">
            <a href={hrefForEvent(step.event)}>
              <rect
                x={x}
                y={y}
                width={STEP_W}
                height={STEP_H}
                rx={6}
                className="lifecycle__step-box"
              />
              <text
                x={x + STEP_W / 2}
                y={y + 22}
                className="lifecycle__step-index"
                textAnchor="middle"
              >
                Шаг {i + 1}
              </text>
              <text
                x={x + STEP_W / 2}
                y={y + 42}
                className="lifecycle__step-name"
                textAnchor="middle"
              >
                {step.displayName ?? step.event}
              </text>
            </a>
            {step.cancel && (
              <g className="lifecycle__cancel">
                <path
                  d={`M ${x + STEP_W / 2} ${y + STEP_H} L ${x + STEP_W / 2} ${y + STEP_H + CANCEL_H}`}
                  className="lifecycle__cancel-arrow"
                  fill="none"
                  markerEnd="url(#arrow-cancel)"
                />
                <text
                  x={x + STEP_W / 2}
                  y={y + STEP_H + CANCEL_H + 12}
                  textAnchor="middle"
                  className="lifecycle__cancel-label"
                >
                  ✗ Отказ
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
