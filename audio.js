function createFlightAudio() {
  let context, master, compressor, engine, engineGain, wind, windGain, noise;
  let muted = false;
  const voices = new Set();

  function connect(source, filter, gain) {
    source.connect(filter).connect(gain).connect(compressor);
  }

  function activate() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!context) {
      context = new Audio();
      master = context.createGain();
      master.gain.value = muted ? 0 : .57;
      compressor = context.createDynamicsCompressor();
      compressor.connect(master).connect(context.destination);

      noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

      engine = context.createOscillator();
      engine.type = 'sawtooth';
      engine.frequency.value = 65;
      const lowpass = context.createBiquadFilter();
      lowpass.frequency.value = 210;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      connect(engine, lowpass, engineGain);
      engine.start();

      const air = context.createBufferSource();
      air.buffer = noise;
      air.loop = true;
      wind = context.createBiquadFilter();
      wind.type = 'bandpass';
      wind.Q.value = .7;
      wind.frequency.value = 550;
      windGain = context.createGain();
      windGain.gain.value = 0;
      connect(air, wind, windGain);
      air.start();
    }
    setPlaying(true);
  }

  function setPlaying(playing) {
    if (!context) return;
    if (!playing) for (const voice of voices) voice.stop();
    void (playing ? context.resume() : context.suspend()).catch(() => {});
  }

  function setMuted(value) {
    muted = value;
    if (master) master.gain.setTargetAtTime(value ? 0 : .57, context.currentTime, .025);
  }

  function flight(player) {
    if (context?.state !== 'running') return;
    const now = context.currentTime;
    const alive = player.hp > 0;
    engine.frequency.setTargetAtTime(37 + player.speed * .18 + (player.boost ? 18 : 0), now, .07);
    engineGain.gain.setTargetAtTime(alive ? (player.boost ? .099 : .057) : 0, now, .08);
    wind.frequency.setTargetAtTime(300 + player.speed * 2.7, now, .14);
    windGain.gain.setTargetAtTime(alive ? .018 + player.speed * .00018 : 0, now, .1);
  }

  const effects = {
    cannon: [.085, 1450, 330, .24], hostile: [.12, 820, 240, .13],
    hit: [.16, 790, 155, .29], explosion: [.57, 690, 48, .48],
    boost: [.42, 440, 155, .25], scrape: [.23, 920, 180, .27]
  };

  function play(name, volume = 1) {
    if (muted || context?.state !== 'running' || voices.size >= 10) return;
    const [length, high, low, level] = effects[name];
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = noise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(high, now);
    filter.frequency.exponentialRampToValueAtTime(low, now + length);
    envelope.gain.setValueAtTime(level * volume, now);
    envelope.gain.exponentialRampToValueAtTime(.001, now + length);
    connect(source, filter, envelope);
    voices.add(source);
    source.onended = () => {
      voices.delete(source);
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
    source.start(now, Math.random());
    source.stop(now + length);
  }

  return {activate, setPlaying, setMuted, flight, play};
}
