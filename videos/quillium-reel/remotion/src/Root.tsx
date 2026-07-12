import React from "react";
import { Composition } from "remotion";
import { QuilliumReel } from "./QuilliumReel";

export const RemotionRoot: React.FC = () => (
    <Composition
        id="QuilliumReel"
        component={QuilliumReel}
        durationInFrames={810}
        fps={30}
        width={1080}
        height={1920}
    />
);
