import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  spring,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  delayRender,
  continueRender,
} from 'remotion';

interface Scene {
  index: number;
  startMs: number;
  endMs: number;
  scriptChunk?: string;
  brollQuery?: string;
  brollMediaUrl?: string;
  brollType?: 'video' | 'image' | 'avatar' | 'raw';
  transition?: 'cut' | 'fade' | 'zoom_in' | 'slide_left' | 'wipe';
  captionText?: string;
}

interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
  highlight?: boolean;
}

interface ProjectData {
  id: string;
  title: string;
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  resolution: '720p' | '1080p' | '4k';
  duration: number;
  transcription?: WordTimestamp[];
  scenes?: Scene[];
  rawVideoUrl?: string;
  outputVideoUrl?: string;
  editingPreferences?: {
    backgroundMusic?: string;
    musicVolume?: number;
    autoDucking?: boolean;
    zoomIntensity?: 'none' | 'subtle' | 'dynamic';
    highlightKeywords?: boolean;
  };
  backgroundMusic?: string;
  musicVolume?: number;
  autoDucking?: boolean;
  zoomIntensity?: 'none' | 'subtle' | 'dynamic';
  highlightKeywords?: boolean;
}

interface EditorVideoCompositionProps {
  projectData?: ProjectData;
  frame?: number;
  durationInFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
}

const getSceneStartFrame = (scene: Scene, fps: number) => {
    const startMs = scene.startMs ?? 0;
    return Math.floor((startMs / 1000) * fps);
  };
  const getSceneEndFrame = (scene: Scene, fps: number) => {
    const endMs = scene.endMs ?? 0;
    return Math.floor((endMs / 1000) * fps);
  };
  const getSceneDurationFrames = (scene: Scene, fps: number) => getSceneEndFrame(scene, fps) - getSceneStartFrame(scene, fps);

  const getWordStartFrame = (word: WordTimestamp, fps: number) => {
    const startMs = word.startMs ?? 0;
    return Math.floor((startMs / 1000) * fps);
  };
  const getWordEndFrame = (word: WordTimestamp, fps: number) => {
    const endMs = word.endMs ?? 0;
    return Math.floor((endMs / 1000) * fps);
  };
  const getWordDurationFrames = (word: WordTimestamp, fps: number) => getWordEndFrame(word, fps) - getWordStartFrame(word, fps);

export const EditorVideoComposition = React.forwardRef<HTMLDivElement, EditorVideoCompositionProps>((props, ref) => {
  const currentFrameHook = useCurrentFrame();
  const videoConfig = useVideoConfig();

  // Safely extract projectData from props or inputProps or fallback
  const projectData: Partial<ProjectData> =
    props.projectData ||
    (props as any)?.inputProps?.projectData ||
    (props as any) ||
    {};

  // Ensure all numeric values are valid
  const safeWidth = props.width || videoConfig.width || 1080;
  const safeHeight = props.height || videoConfig.height || 1920;
  const safeFps = props.fps || videoConfig.fps || 30;
  const safeFrame = Number.isFinite(props.frame) ? props.frame! : currentFrameHook;
  const safeDurationInFrames = Number.isFinite(props.durationInFrames)
    ? props.durationInFrames!
    : videoConfig.durationInFrames || safeFps * 30;

  // Debug: log received data
  if (typeof window !== 'undefined' && safeFrame === 0) {
    console.log('[EditorVideoComposition] Project data:', {
      hasVideo: !!(projectData.outputVideoUrl || projectData.rawVideoUrl),
      videoUrl: projectData.outputVideoUrl || projectData.rawVideoUrl,
      wordsCount: projectData.transcription?.length || 0,
      scenesCount: projectData.scenes?.length || 0,
      firstWord: projectData.transcription?.[0],
      firstScene: projectData.scenes?.[0],
    });
  }
  
  const scenes = projectData.scenes || [];
  const words = projectData.transcription || [];
  const activeScene = scenes.find(s => safeFrame >= getSceneStartFrame(s, safeFps) && safeFrame < getSceneEndFrame(s, safeFps));
  
  const isVertical = projectData.aspectRatio === '9:16';
  const isSquare = projectData.aspectRatio === '1:1';
  const isPortrait = projectData.aspectRatio === '4:5';

  // Main video or image track - plays the raw video, image, or output video
  const mainVideoSrc = projectData.outputVideoUrl || projectData.rawVideoUrl;
  const isImageMedia = mainVideoSrc && (
    /\.(jpg|jpeg|png|webp|avif|gif)(\?.*)?$/i.test(mainVideoSrc) ||
    mainVideoSrc.includes('/images/')
  );
  
  // Background music track
  const bgMusicSrc = projectData.backgroundMusic || projectData.editingPreferences?.backgroundMusic;
  const musicVolume = projectData.musicVolume ?? projectData.editingPreferences?.musicVolume ?? 15;
  const autoDucking = projectData.autoDucking ?? projectData.editingPreferences?.autoDucking ?? true;
  const zoomIntensity = projectData.zoomIntensity ?? projectData.editingPreferences?.zoomIntensity ?? 'subtle';

  return (
    <AbsoluteFill ref={ref} style={{ width: safeWidth, height: safeHeight, backgroundColor: '#11141D' }}>
      {/* Fallback background while video loads */}
      <div style={{ width: '100%', height: '100%', backgroundColor: '#11141D' }} />

      {/* Standby Placeholder when no media is uploaded yet */}
      {!mainVideoSrc && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at center, #1e2230 0%, #0d0f14 100%)',
            padding: 30,
            textAlign: 'center',
            color: '#94a3b8',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              color: '#818cf8',
              fontSize: 32,
            }}
          >
            🎬
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', marginBottom: 6 }}>
            Studio Canvas Ready
          </div>
          <div style={{ fontSize: 12, maxWidth: 300, lineHeight: 1.5, opacity: 0.8 }}>
            Click <strong>Upload Video / Image</strong> above or click <strong>Transcribe & Generate Captions</strong> to begin editing.
          </div>
        </div>
      )}
      
      {/* Main Video or Image Track - Base Layer */}
      {mainVideoSrc && (
        <Sequence
          from={0}
          durationInFrames={safeDurationInFrames}
          name="MainMedia"
          style={{ width: safeWidth, height: safeHeight, objectFit: 'cover' }}
        >
          {isImageMedia ? (
            <img
              src={mainVideoSrc}
              alt="Media Background"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                backgroundColor: '#11141D',
              }}
            />
          ) : (
            ((({ frame: sequenceFrame }: { frame: number }) => (
              <video
                ref={(el) => {
                  if (el) {
                    el.currentTime = sequenceFrame / safeFps;
                    el.play().catch(() => {});
                  }
                }}
                src={mainVideoSrc}
                autoPlay
                loop
                muted
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  backgroundColor: '#11141D',
                }}
              />
            )) as any)
          )}
        </Sequence>
      )}

      {/* B-Roll Overlay Track */}
      {scenes.map((scene, sceneIndex) => {
        if (!scene.brollMediaUrl && !scene.brollQuery) return null;
        
        const sceneStartFrame = getSceneStartFrame(scene, safeFps);
        const sceneEndFrame = getSceneEndFrame(scene, safeFps);
        const sceneDurationFrames = getSceneDurationFrames(scene, safeFps);
        
        // Skip if scene has invalid timing
        if (!Number.isFinite(sceneStartFrame) || !Number.isFinite(sceneEndFrame) || sceneDurationFrames <= 0) {
          return null;
        }
        
        if (safeFrame < sceneStartFrame || safeFrame >= sceneEndFrame) return null;
        
        const localFrame = safeFrame - sceneStartFrame;
        const transition = scene.transition || 'cut';
        const brollOpacity = spring({
          frame: localFrame,
          fps: safeFps,
          config: { damping: 20, stiffness: 150 },
          from: 0,
          to: 1,
        });
        
        // Transition effects
        const getTransitionStyle = () => {
          if (transition === 'fade') {
            return { opacity: brollOpacity };
          } else if (transition === 'slide_left') {
            return {
              transform: `translateX(${interpolate(brollOpacity, [0, 1], [safeWidth, 0])}px)`,
            };
          } else if (transition === 'zoom_in') {
            return {
              transform: `scale(${interpolate(brollOpacity, [0, 1], [1.3, 1])})`,
              opacity: brollOpacity,
            };
          }
          return { opacity: 1 };
        };
        
        return (
          <Sequence
            key={`broll-${sceneIndex}`}
            from={sceneStartFrame}
            durationInFrames={sceneDurationFrames}
            name={`B-Roll-${sceneIndex}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: safeWidth,
              height: safeHeight,
              objectFit: 'cover',
              zIndex: 10,
              ...getTransitionStyle(),
            }}
          >
            {((({ frame: sequenceFrame }: { frame: number }) => (
              <> as React.ReactNode
                {scene.brollMediaUrl && scene.brollType === 'video' && (
                  <video
                    ref={(el) => {
                      if (el) {
                        el.currentTime = sequenceFrame / safeFps;
                      }
                    }}
                    src={scene.brollMediaUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                )}
                {scene.brollMediaUrl && scene.brollType === 'image' && (
                  <img
                    src={scene.brollMediaUrl}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                )}
              </>
            )) as any)}
          </Sequence>
        );
      })}

      {/* Captions/Karaoke Track */}
      {words.map((word, wordIndex) => {
        const wordStartFrame = getWordStartFrame(word, safeFps);
        const wordEndFrame = getWordEndFrame(word, safeFps);
        const wordDurationFrames = getWordDurationFrames(word, safeFps);
        
        // Skip if word has invalid timing
        if (!Number.isFinite(wordStartFrame) || !Number.isFinite(wordEndFrame) || wordDurationFrames <= 0) {
          return null;
        }
        
        if (safeFrame < wordStartFrame || safeFrame >= wordEndFrame) return null;
        
        const localFrame = safeFrame - wordStartFrame;
        const progress = localFrame / wordDurationFrames;
        
// Karaoke highlight animation
        const highlightProgress = spring({
          frame: localFrame,
          fps: safeFps,
          config: { damping: 25, stiffness: 200 },
          from: 0,
          to: 1,
        });
        
        // Position based on aspect ratio
        const bottomMargin = isVertical ? safeHeight * 0.22 : safeHeight * 0.1;
        const fontSize = isVertical ? Math.max(48, safeWidth * 0.065) : Math.max(36, safeWidth * 0.035);
        
        return (
          <Sequence
            key={`caption-${wordIndex}`}
            from={wordStartFrame}
            durationInFrames={wordDurationFrames}
            name={`Caption-${wordIndex}`}
            style={{
              position: 'absolute',
              bottom: bottomMargin,
              left: safeWidth * 0.05,
              right: safeWidth * 0.05,
              zIndex: 50,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            {((({ frame: sequenceFrame }: { frame: number }) => (
              <div
                style={{
                  textAlign: 'center',
                  color: 'white',
                  fontSize: `${fontSize}px`,
                  fontWeight: '900',
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                  lineHeight: 1.2,
                  textShadow: `
                    0 0 4px rgba(0,0,0,0.8),
                    0 4px 8px rgba(0,0,0,0.6),
                    0 8px 16px rgba(0,0,0,0.4)
                  `,
                  fontFamily: '"Cabinet Grotesk", "Inter", system-ui, sans-serif',
                }}
              >
                <span
                  style={{
                    background: word.highlight
                      ? 'linear-gradient(90deg, #fde047, #facc15, #fde047)'
                      : 'linear-gradient(90deg, #ffffff, #ffffff)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    display: 'inline-block',
                    padding: '0.1em 0.05em',
                  }}
                >
                  {word.word.toUpperCase()}
                </span>
              </div>
            )) as any)}
          </Sequence>
        );
      })}

      {/* Audio Tracks */}
      {/* Main video audio */}
      {mainVideoSrc && (
        <Audio
          src={mainVideoSrc}
          startFrom={0}
          endAt={safeDurationInFrames}
          volume={1}
        />
      )}

      {/* Background music with ducking */}
      {bgMusicSrc && autoDucking && (
        <Audio
          src={bgMusicSrc}
          startFrom={0}
          endAt={safeDurationInFrames}
          volume={musicVolume / 100}
        />
      )}

      {/* Zoom effects based on preference */}
      {zoomIntensity !== 'none' && activeScene && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 5,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transformOrigin: 'center center',
              transform: `
                scale(${zoomIntensity === 'dynamic' ? 1.15 : 1.05})
              `,
            }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
});

EditorVideoComposition.displayName = 'EditorVideoComposition';