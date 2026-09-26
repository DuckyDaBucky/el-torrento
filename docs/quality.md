# Quality

Auto is the default. It watches buffer and delivery speed, then restarts the single rendition at the current position. That uses the same generation rule as seek: old segment requests die when a new generation starts. This is not a multi-bitrate HLS ladder.

Manual quality stays at the chosen level. If it keeps buffering, the player can suggest Auto. It does not silently switch.

2160p is offered only when the source is at least that tall and the encoder path can keep up. Software transcode is not assumed. If the Intel iGPU path is not proven on the playback VM, 4K conversion stays queued or hidden until a benchmark says otherwise.

Lowering the bitrate does not make missing torrent pieces arrive faster. The player can say why it is buffering (slow client, home upload full, torrent slow, encoder behind, storage) without asking the family to debug it.

Direct play and remux are preferred. A remux is not proof that every HDR or audio flag survived.
