// VR Audio Mixer
// 物理マイク + TTS音声 → 仮想オーディオデバイス（VB-CABLE等）にミックス出力
// VRChatのマイクを仮想デバイスにすれば、自分の声とコンパニオンの声が両方聞こえる

let micStream: MediaStream | null = null;
let mixerCtx: AudioContext | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let _virtualDeviceId = '';
let _isActive = false;

/** ミキサー起動: 物理マイクを仮想デバイスに転送 */
export async function startMixer(virtualDeviceId: string, micDeviceId?: string): Promise<boolean> {
  try {
    await stopMixer();

    _virtualDeviceId = virtualDeviceId;

    // 物理マイク取得
    const constraints: MediaStreamConstraints = {
      audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true
    };
    micStream = await navigator.mediaDevices.getUserMedia(constraints);

    // AudioContextを仮想デバイスに出力
    mixerCtx = new AudioContext({ sinkId: virtualDeviceId } as any);

    // マイク→仮想デバイス
    micSource = mixerCtx.createMediaStreamSource(micStream);
    micSource.connect(mixerCtx.destination);

    _isActive = true;
    console.log('🎤 VR Audio Mixer開始:', virtualDeviceId);
    return true;
  } catch (err) {
    console.error('❌ VR Audio Mixer開始失敗:', err);
    await stopMixer();
    return false;
  }
}

/** TTS音声を仮想デバイスにも流す（元のAudioは別途ローカルで鳴る） */
export async function routeTTSToVirtual(audioData: ArrayBuffer, mimeType: string = 'audio/wav'): Promise<void> {
  if (!mixerCtx || !_isActive) return;

  try {
    // 音声データをデコードしてミキサー経由で仮想デバイスに再生
    const buffer = await mixerCtx.decodeAudioData(audioData.slice(0));
    const source = mixerCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(mixerCtx.destination);
    source.start();
  } catch (err) {
    console.error('❌ TTS仮想デバイス転送失敗:', err);
  }
}

/** ミキサー停止 */
export async function stopMixer(): Promise<void> {
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (mixerCtx) {
    await mixerCtx.close().catch(() => {});
    mixerCtx = null;
  }
  _isActive = false;
  console.log('🎤 VR Audio Mixer停止');
}

export function isActive(): boolean {
  return _isActive;
}

export function getVirtualDeviceId(): string {
  return _virtualDeviceId;
}
