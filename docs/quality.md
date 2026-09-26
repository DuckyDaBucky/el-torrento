# Quality

Auto starts on the original file. If it buffers and a lower rendition exists, it switches and keeps the playhead. Manual quality does the same: the player sends `positionSeconds`, and the server stores that position instead of restarting at 0.

Transcoded renditions are HLS segments built from verified torrent bytes. The worker does not wait for the whole file to finish. A range inside the file that is still downloading is a wait (then verified bytes), not HTTP 416. 416 is only for a range outside the file.

Manual quality stays at the chosen level. If it keeps buffering, the player can suggest Auto. It does not silently switch.

2160p is offered only when the source is at least that tall and the encoder path can keep up. Software transcode is not assumed. If the Intel iGPU path is not proven on the playback VM, 4K conversion stays queued or hidden until a benchmark says otherwise.

Lowering the bitrate does not make missing torrent pieces arrive faster. The player can say why it is buffering (slow client, home upload full, torrent slow, encoder behind, storage) without asking the family to debug it.

Direct play and remux are preferred. A remux is not proof that every HDR or audio flag survived.
