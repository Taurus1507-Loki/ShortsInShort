import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Composition,
  getInputProps,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { EditorVideoComposition } from './EditorVideoComposition.js';

interface RootCompositionProps {
  projectData?: any;
}

export const RootComposition: React.FC<RootCompositionProps> = ({ projectData }) => {
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  const aspectRatio = projectData?.aspectRatio || '9:16';
  const resolution = projectData?.resolution || '1080p';
  
  // Calculate actual dimensions based on aspect ratio and resolution
  const getDimensions = () => {
    const resolutions = {
      '720p': { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [720, 720], '4:5': [720, 900] },
      '1080p': { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] },
      '4k': { '9:16': [2160, 3840], '16:9': [3840, 2160], '1:1': [2160, 2160], '4:5': [2160, 2700] },
    };
    return resolutions[resolution as keyof typeof resolutions]?.[aspectRatio as keyof typeof resolutions['1080p']] || [1080, 1920];
  };

  const [actualWidth, actualHeight] = getDimensions();

  return (
    <EditorVideoComposition
      projectData={projectData}
      frame={frame}
      durationInFrames={durationInFrames}
      fps={fps}
      width={actualWidth}
      height={actualHeight}
    />
  );
};

export const RemotionVideo: React.FC<{ projectData: any }> = ({ projectData }) => {
  const { width, height, fps, durationInFrames } = useVideoConfig();
  
  const getDimensions = () => {
    const resolutions = {
      '720p': { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [720, 720], '4:5': [720, 900] },
      '1080p': { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] },
      '4k': { '9:16': [2160, 3840], '16:9': [3840, 2160], '1:1': [2160, 2160], '4:5': [2160, 2700] },
    };
    return resolutions[projectData?.resolution as keyof typeof resolutions]?.[projectData?.aspectRatio as keyof typeof resolutions['1080p']] || [1080, 1920];
  };

  const [actualWidth, actualHeight] = getDimensions();

  return (
    <Composition
      id="EditorVideoComposition"
      component={RootComposition}
      durationInFrames={durationInFrames}
      fps={fps}
      width={actualWidth}
      height={actualHeight}
      defaultProps={{ projectData }}
    />
  );
};

export { Composition, AbsoluteFill, Audio, Sequence, spring, interpolate, useCurrentFrame, useVideoConfig, getInputProps };