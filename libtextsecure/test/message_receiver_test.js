describe('MessageReceiver', () => {
  textsecure.storage.impl = new SignalProtocolStore();
  const WebSocket = window.WebSocket;
  const number = '+19999999999';
  const deviceId = 1;
  const signalingKey = libsignal.crypto.getRandomBytes(32 + 20);
  before(() => {
    window.WebSocket = MockSocket;
    textsecure.storage.user.setNumberAndDeviceId(number, deviceId, 'name');
    textsecure.storage.put('password', 'password');
    textsecure.storage.put('signaling_key', signalingKey);
  });
  after(() => {
    window.WebSocket = WebSocket;
  });

  describe('connecting', () => {
    const blob = null;
    const attrs = {
      type: textsecure.protobuf.Envelope.Type.CIPHERTEXT,
      source: number,
      sourceDevice: deviceId,
      timestamp: Date.now(),
    };
    const websocketmessage = new textsecure.protobuf.WebSocketMessage({
      type: textsecure.protobuf.WebSocketMessage.Type.REQUEST,
      request: { verb: 'PUT', path: '/messages' },
    });

    before(done => {
      const signal = new textsecure.protobuf.Envelope(attrs).toArrayBuffer();
      const data = new textsecure.protobuf.DataMessage({ body: 'hello' });

      const signaling_key = signalingKey;
      const aes_key = signaling_key.slice(0, 32);
      const mac_key = signaling_key.slice(32, 32 + 20);

      window.crypto.subtle
        .importKey('raw', aes_key, { name: 'AES-CBC' }, false, ['encrypt'])
        .then(key => {
          const iv = libsignal.crypto.getRandomBytes(16);
          window.crypto.subtle
            .encrypt({ name: 'AES-CBC', iv: new Uint8Array(iv) }, key, signal)
            .then(ciphertext => {
              window.crypto.subtle
                .importKey(
                  'raw',
                  mac_key,
                  { name: 'HMAC', hash: { name: 'SHA-256' } },
                  false,
                  ['sign']
                )
                .then(key => {
                  window.crypto.subtle
                    .sign({ name: 'HMAC', hash: 'SHA-256' }, key, signal)
                    .then(mac => {
                      const version = new Uint8Array([1]);
                      const message = dcodeIO.ByteBuffer.concat([
                        version,
                        iv,
                        ciphertext,
                        mac,
                      ]);
                      websocketmessage.request.body = message.toArrayBuffer();
                      done();
                    });
                });
            });
        });
    });

    it('connects', done => {
      const mockServer = new MockServer(
        `ws://localhost:8080/v1/websocket/?login=${encodeURIComponent(
          number
        )}.1&password=password`
      );

      mockServer.on('connection', server => {
        server.send(new Blob([websocketmessage.toArrayBuffer()]));
      });

      window.addEventListener('textsecure:message', ev => {
        const signal = ev.proto;
        for (const key in attrs) {
          assert.strictEqual(attrs[key], signal[key]);
        }
        assert.strictEqual(signal.message.body, 'hello');
        server.close();
        done();
      });
      const messageReceiver = new textsecure.MessageReceiver(
        'ws://localhost:8080',
        window
      );
    });
  });
});
