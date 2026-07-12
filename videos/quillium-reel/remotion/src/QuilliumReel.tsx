import React from "react";
import {
    AbsoluteFill,
    Audio,
    Easing,
    interpolate,
    Sequence,
    staticFile,
    useCurrentFrame,
} from "remotion";
import "./style.css";

const purple = "#a855f7";
const ink = "#171419";
const paper = "#fbfbf8";
const border = "#e8d8f7";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

const enter = (frame: number, at = 0, duration = 24): number =>
    interpolate(frame, [at, at + duration], [0, 1], { ...clamp, easing: ease });

const exit = (frame: number, at: number, duration = 24): number =>
    interpolate(frame, [at, at + duration], [1, 0], { ...clamp, easing: ease });

const sceneStyle = (frame: number, hold: number) => ({
    opacity: enter(frame, 0, 22) * exit(frame, hold, 22),
});

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="eyebrow">{children}</div>
);

const Pill: React.FC<{
    children: React.ReactNode;
    selected?: boolean;
    muted?: boolean;
    linked?: boolean;
}> = ({ children, selected, muted, linked }) => (
    <div className={`pill ${selected ? "selected" : ""} ${muted ? "muted" : ""}`}>
        {children}
        {linked ? <span className="linkmark">⌁</span> : null}
        {!selected && !muted ? <span className="close">×</span> : null}
    </div>
);

const RevisionCard: React.FC<{
    label?: string;
    selected?: "Original" | "Active voice" | "Expanded" | "Sharper image";
    text: React.ReactNode;
    nested?: boolean;
    style?: React.CSSProperties;
    showCompressed?: boolean;
}> = ({ label = "REVISION", selected = "Original", text, nested, style, showCompressed = true }) => {
    const versions = nested ? ["Original", "Sharper image"] : ["Original", "Active voice"];
    return (
        <div className={`revision-card ${nested ? "nested" : ""}`} style={style}>
            <div className="card-top">
                <Eyebrow>{label}</Eyebrow>
                <div className="card-icons">↗&nbsp;&nbsp;⌫</div>
            </div>
            <div className="pill-row">
                {versions.map((version) => (
                    <Pill key={version} selected={selected === version} linked={nested}>
                        {version}
                    </Pill>
                ))}
            </div>
            {!nested && showCompressed ? (
                <div className="pill-row second-row">
                    <Pill muted>Compressed&nbsp;&nbsp;⌁&nbsp;×</Pill>
                </div>
            ) : null}
            <div className="new-version">＋&nbsp; New Version <span>⌘ ↵</span></div>
            <div className="editor-text">{text}</div>
        </div>
    );
};

type Branch = { d: string; depth: number };

const makeTree = (): Branch[] => {
    const lines: Branch[] = [];
    const walk = (x: number, y: number, angle: number, length: number, depth: number) => {
        if (depth > 7) return;
        const x2 = x + Math.cos(angle) * length;
        const y2 = y - Math.sin(angle) * length;
        const bend = (depth % 2 === 0 ? 1 : -1) * length * 0.08;
        lines.push({
            d: `M ${x} ${y} Q ${(x + x2) / 2 + bend} ${(y + y2) / 2} ${x2} ${y2}`,
            depth,
        });
        const spread = 0.43 - depth * 0.025;
        walk(x2, y2, angle - spread, length * 0.72, depth + 1);
        walk(x2, y2, angle + spread, length * 0.72, depth + 1);
    };
    walk(540, 1570, Math.PI / 2, 330, 0);
    return lines;
};

const tree = makeTree();

const SceneOne: React.FC = () => {
    const frame = useCurrentFrame();
    const fade = sceneStyle(frame, 140);
    return (
        <AbsoluteFill className="scene" style={fade}>
            <svg className="tree" viewBox="0 0 1080 1920">
                {tree.map((branch, index) => {
                    const p = enter(frame, 8 + branch.depth * 11, 34);
                    return (
                        <path
                            key={index}
                            d={branch.d}
                            pathLength={1}
                            stroke={branch.depth > 4 ? "#c17af9" : purple}
                            strokeWidth={Math.max(1.4, 5 - branch.depth * 0.45)}
                            strokeDasharray={1}
                            strokeDashoffset={1 - p}
                            fill="none"
                            opacity={0.95 - branch.depth * 0.06}
                        />
                    );
                })}
            </svg>
            <div className="opening-copy" style={{ opacity: enter(frame, 72, 30) }}>
                <Eyebrow>QUILLIUM</Eyebrow>
                <h1>Your thoughts don’t go<br />in a straight line.</h1>
                <div className="hairline" />
            </div>
        </AbsoluteFill>
    );
};

const SceneTwo: React.FC = () => {
    const frame = useCurrentFrame();
    const cardP = enter(frame, 58, 66);
    const cards = [
        { text: "The rain found her…", x: 112, y: 260 },
        { text: "She stepped into…", x: 545, y: 380 },
        { text: "Rain met her…", x: 318, y: 510 },
    ];
    return (
        <AbsoluteFill className="scene" style={sceneStyle(frame, 158)}>
            <div className="ghost-orbit" />
            {cards.map((card, i) => {
                const collapse = enter(frame, 35 + i * 5, 58);
                return (
                    <div
                        className="sentence-branch"
                        key={card.text}
                        style={{
                            left: interpolate(collapse, [0, 1], [card.x, 154]),
                            top: interpolate(collapse, [0, 1], [card.y, 474]),
                            opacity: 1 - collapse * 0.82,
                            transform: `scale(${1 - collapse * 0.12})`,
                        }}
                    >
                        {card.text}
                    </div>
                );
            })}
            <div
                className="feature-wrap"
                style={{
                    opacity: cardP,
                    transform: `translateY(${interpolate(cardP, [0, 1], [80, 0])}px) scale(${interpolate(cardP, [0, 1], [0.94, 1])})`,
                }}
            >
                <div className="sentence-strip">The rain found her…</div>
                <RevisionCard
                    text={<>The rain found her beneath the station clock.</>}
                />
            </div>
            <div className="lower-copy" style={{ opacity: enter(frame, 116, 28) }}>
                <Eyebrow>REVISION PATHS</Eyebrow>
                <h2>Fork any sentence.<br /><span>Keep every version.</span></h2>
            </div>
        </AbsoluteFill>
    );
};

const SceneThree: React.FC = () => {
    const frame = useCurrentFrame();
    const panelP = enter(frame, 24, 38);
    const clickP = enter(frame, 76, 20);
    const active = frame >= 86;
    return (
        <AbsoluteFill className="scene" style={sceneStyle(frame, 146)}>
            <div className="scene-heading" style={{ opacity: enter(frame, 8, 24) }}>
                <Eyebrow>REVISION</Eyebrow>
                <h2>In the draft.</h2>
            </div>
            <div className="document" style={{ opacity: enter(frame, 10, 28) }}>
                <p>
                    <span className={active ? "sentence active" : "sentence"}>
                        {active
                            ? "Beneath the station clock, the rain found her."
                            : "The rain found her beneath the station clock."}
                    </span>{" "}
                    Her coat darkened at the shoulders as she turned a letter over in her hand.
                </p>
                <p>She watched the departures board change twice before she finally looked up.</p>
            </div>
            <RevisionCard
                selected={active ? "Active voice" : "Original"}
                text={
                    active
                        ? <>Beneath the station clock, the rain found her.</>
                        : <>The rain found her beneath the station clock.</>
                }
                style={{
                    opacity: panelP,
                    transform: `translateY(${interpolate(panelP, [0, 1], [90, 0])}px)`,
                    position: "absolute",
                    left: 74,
                    top: 660,
                    width: 932,
                }}
            />
            <div
                className="cursor"
                style={{
                    opacity: interpolate(clickP, [0, 0.2, 1], [0, 1, 1], clamp),
                    left: interpolate(clickP, [0, 1], [710, 555]),
                    top: interpolate(clickP, [0, 1], [1120, 815]),
                }}
            >
                <svg viewBox="0 0 44 54" aria-hidden="true">
                    <path d="M4 3 L38 29 L22 32 L15 49 Z" fill="#171419" stroke="#fbfbf8" strokeWidth="3" />
                </svg>
            </div>
            <div className="bottom-statement" style={{ opacity: enter(frame, 110, 25) }}>
                Compare every version<br />where the sentence lives.
            </div>
        </AbsoluteFill>
    );
};

const SceneFour: React.FC = () => {
    const frame = useCurrentFrame();
    const outerP = enter(frame, 4, 24);
    const connectorP = enter(frame, 48, 30);
    const nestedP = enter(frame, 62, 36);
    return (
        <AbsoluteFill className="scene" style={sceneStyle(frame, 100)}>
            <div className="scene-heading hierarchy-title" style={{ opacity: enter(frame, 0, 22) }}>
                <Eyebrow>NESTED REVISION</Eyebrow>
                <h2>Branch inside a branch.</h2>
            </div>
            <div
                className="outer-card"
                style={{
                    opacity: outerP,
                    transform: `translateY(${interpolate(outerP, [0, 1], [70, 0])}px)`,
                }}
            >
                <div className="hierarchy-label">OUTER REVISION · EXPANDED</div>
                <div className="card-top">
                    <Eyebrow>REVISION</Eyebrow><div className="card-icons">↗&nbsp;&nbsp;⌫</div>
                </div>
                <div className="pill-row">
                    <Pill>Original</Pill><Pill selected>Expanded</Pill><Pill muted>Spare</Pill>
                </div>
                <div className="outer-copy">
                    The rain found her beneath the station clock, <span>her rain-dark coat shining under the lamps</span> while the last train sighed away.
                </div>
            </div>
            <svg className="nest-connector" viewBox="0 0 1080 1920">
                <path
                    d="M 615 842 C 720 910, 748 972, 688 1050"
                    pathLength={1}
                    stroke={purple}
                    strokeWidth={3}
                    strokeDasharray={1}
                    strokeDashoffset={1 - connectorP}
                    fill="none"
                />
                <circle cx="615" cy="842" r={8 * connectorP} fill={purple} />
            </svg>
            <RevisionCard
                nested
                selected="Sharper image"
                label="NESTED REVISION · IMAGE"
                text={<>her rain-dark coat <span className="nested-emphasis">gleaming beneath the lamps</span></>}
                style={{
                    opacity: nestedP,
                    transform: `translateY(${interpolate(nestedP, [0, 1], [110, 0])}px) scale(${interpolate(nestedP, [0, 1], [0.94, 1])})`,
                    position: "absolute",
                    left: 228,
                    top: 1035,
                    width: 778,
                    boxShadow: "0 28px 80px rgba(66, 32, 84, 0.12)",
                }}
            />
            <div className="depth-note" style={{ opacity: enter(frame, 88, 18) }}>
                Every version can hold its own revisions.
            </div>
        </AbsoluteFill>
    );
};

const Feather: React.FC<{ progress: number }> = ({ progress }) => (
    <svg className="feather" viewBox="0 0 360 420">
        <path
            d="M270 40 C210 56 120 120 92 214 C78 260 82 304 101 344 C120 270 157 216 218 172 C253 146 274 102 270 40 Z"
            fill="none"
            stroke={purple}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - progress}
        />
        <path
            d="M266 46 C218 118 172 190 127 272 C110 302 101 330 100 364"
            fill="none"
            stroke={purple}
            strokeWidth="6"
            strokeLinecap="round"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - progress}
        />
    </svg>
);

const SceneFive: React.FC = () => {
    const frame = useCurrentFrame();
    const morph = enter(frame, 8, 66);
    return (
        <AbsoluteFill className="scene closing" style={{ opacity: enter(frame, 0, 18) }}>
            <div className="closing-orbit" style={{ transform: `scale(${0.8 + morph * 0.2})`, opacity: 0.35 + morph * 0.4 }} />
            <div className="branch-remnant" style={{ opacity: 1 - morph, transform: `scale(${1 - morph * 0.2})` }}>
                <span /><span /><span />
            </div>
            <Feather progress={morph} />
            <div className="closing-copy" style={{ opacity: enter(frame, 62, 34) }}>
                <Eyebrow>QUILLIUM</Eyebrow>
                <h2>Start writing sideways.</h2>
                <p>Write freely. Keep every path.</p>
                <div className="cta">Explore Quillium <span>→</span></div>
            </div>
        </AbsoluteFill>
    );
};

export const QuilliumReel: React.FC = () => (
    <AbsoluteFill className="film">
        <Audio src={staticFile("audio/quillium-bed.wav")} volume={0.72} />
        <Sequence from={0} durationInFrames={162}><SceneOne /></Sequence>
        <Sequence from={150} durationInFrames={192}><SceneTwo /></Sequence>
        <Sequence from={318} durationInFrames={180}><SceneThree /></Sequence>
        <Sequence from={474} durationInFrames={132}><SceneFour /></Sequence>
        <Sequence from={584} durationInFrames={226}><SceneFive /></Sequence>
    </AbsoluteFill>
);
