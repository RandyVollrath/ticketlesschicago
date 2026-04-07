import React from "react";
import { Composition } from "remotion";
import { TicketlessAd } from "./TicketlessAd";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TicketlessAd"
        component={TicketlessAd}
        durationInFrames={2640}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
