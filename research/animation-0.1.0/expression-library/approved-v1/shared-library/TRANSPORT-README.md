# Lossless transport wrapper

The GitHub connector rejects individual requests above 16 MiB. The canonical GLB and NPZ are therefore stored as gzip files here. No geometry, source arrays or approved hash has changed.

After checkout, run `python materialize_transport.py` in this shared-library directory, then use `restore_library.py` normally. The first step reconstructs the two canonical files with exact SHA256 verification. The original frozen BACKUP-MANIFEST.json intentionally lists the reconstructed canonical bytes. The transport wrapper is separate from artistic validation.

The runtime-slice7 GLB is below the request limit and remains directly available. This transport change does not activate the complete library in the runtime.
