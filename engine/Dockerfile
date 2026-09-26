FROM ubuntu:24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-libtorrent \
  && rm -rf /var/lib/apt/lists/*

COPY server.py /opt/engine/server.py
USER 1000:1000
EXPOSE 8741
ENTRYPOINT ["python3", "/opt/engine/server.py", "--host", "0.0.0.0", "--port", "8741"]
