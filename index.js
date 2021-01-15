const Recorder = {
    recorder: {},
    recordData: {},
    recordDataBuffer: {},
    audioStrem: null,
    audioContext: null,
    slientTimer: null,
    micWorkStateList: [],
    isMicWorkStatus: true,
    watchList: {},
  
    // 当前 micPhone 的权限状态
    MicPhonePermissionStatus: {
      granted: '授予',
      denied: '拒绝',
      prompt: '询问',
    },
  
    // 权限询问框 的状态结果
    MicPhonePermissionPopupStatus: {
      'Permission granted': '授予',
      'Permission denied': '拒绝',
      'Permission dismissed': '关闭',
      'Requested device not found': '无设备',
    },
  
    captureAudioStream() {
      return new Promise((resolve, reject) => {
        // 如果用户处于询问态，此 promise 将一直 pending，所以 10s 后回退到授权失败
        setTimeout(() => {
          reject(new Error('Permission pending'));
        }, 10000);
        // 是否可录制音频
        return navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(stream => {
            // 成功
            this.audioStrem = stream;
            resolve('Permission granted');
          })
          .catch(err => {
            // 失败
            reject(err.message);
          });
      });
    },
  
    queryMicPhonePermission() {
      // 检查当前 麦克风权限 状态
      // 不会调出权限询问框
      return window.navigator.permissions
        .query({
          name: 'microphone',
        })
        .then(p => this.MicPhonePermissionStatus[p.state])
        .catch(() => '非Chrome浏览器');
    },
  
    on(type, callback) {
      if (!this.watchList[type]) {
        this.watchList[type] = [callback];
      } else {
        this.watchList[type].push(callback);
      }
    },
  
    emit(type, args) {
      if (!this.watchList[type]) return;
      this.watchList[type].map(fn => fn.call(this, args));
    },
  
    // 在录制过程中，去判断每一个缓冲区（每个固定体积的音频）的音量，如果音量值小于某个阀值，则说明该设备麦克风没有声音
    takeMicSample() {
      if (this.audioStrem === null) {
        return;
      }
      const minValue = 0.02;
      const audioContext = window.AudioContext || window.webkitAudioContext;
      // eslint-disable-next-line new-cap
      this.audioContext = new audioContext();
      const liveSource = this.audioContext.createMediaStreamSource(
        this.audioStrem,
      );
      const levelChecker = this.audioContext.createScriptProcessor(8192, 1, 1);
      levelChecker.connect(this.audioContext.destination);
      levelChecker.onaudioprocess = audioProcessingEvent => {
        const buffer = audioProcessingEvent.inputBuffer.getChannelData(0);
        let maxVal = 0;
        for (let i = 0; i < buffer.length; i++) {
          if (maxVal < buffer[i]) {
            maxVal = buffer[i];
          }
        }
        if (maxVal > minValue) {
          clearTimeout(this.slientTimer);
          this.emit('updateVolumn', maxVal);
          this.slientTimer = setTimeout(() => {
            this.emit('noInput');
          }, 5000);
          this.micWorkStateList.push(true);
        } else {
          if (!this.slientTimer) {
            this.slientTimer = setTimeout(() => {
              this.emit('noInput');
            }, 5000);
          }
          this.micWorkStateList.push(false);
        }
      };
      liveSource.connect(levelChecker);
    },
  
    closeAudioContextAndUpdateMicStatus() {
      if (this.audioContext === null) {
        this.isMicWorkStatus = false;
        return;
      }
      const micWorkStateListLen = this.micWorkStateList.length;
      this.audioContext.close();
      let isMicWorkListLen = 0;
      this.micWorkStateList.forEach(item => {
        if (item === true) {
          isMicWorkListLen += 1;
        }
      });
      this.micWorkStateList = [];
      // 如果有声音的缓冲区个数大于某个阀值，则大约说明用户在录制过程中麦克风都有录到声音
      if (isMicWorkListLen > parseInt(micWorkStateListLen * 0.2)) {
        this.isMicWorkStatus = true;
      } else {
        this.isMicWorkStatus = false;
      }
    },
  
    captureCanvasStream() {
      const canvasElem = document.getElementById('scratch-stage');
      return canvasElem.captureStream();
    },
  
    getMediaStreamList() {
      const result = {};
      return this.captureAudioStream()
        .then(() => {
          result.canvas = this.captureCanvasStream();
          result.audio = this.audioStrem;
          return result;
        })
        .catch(() => {
          result.canvas = this.captureCanvasStream();
          return result;
        });
    },
  
    checkIsDeviceSupportMediaRecorder() {
      const reg = /iPad/gi;
  
      const result = {
        isIpad: false,
        isBrowserSupport: false,
      };
      result.isIpad = reg.test(navigator.userAgent);
      if (window.MediaRecorder !== undefined) {
        const contentTypes = ['video/webm', 'audio/webm'];
  
        const isSupportArr = [];
        contentTypes.forEach(item => {
          if (MediaRecorder.isTypeSupported(item) === true) {
            isSupportArr.push(MediaRecorder.isTypeSupported(item));
          }
        });
        if (isSupportArr.length === contentTypes.length) {
          result.isBrowserSupport = true;
        }
      }
      return result;
    },
  
    handleDataAvailable(event, recordType) {
      if (event.data && event.data.size > 0) {
        this.recordData[recordType].push(event.data);
      }
    },
  
    runRecorder() {
      const options = [
        {
          canvas: { mimeType: 'video/webm' },
        },
        {
          audio: { mimeType: 'audio/webm' },
        },
      ];
      this.getMediaStreamList().then(streamArr => {
        for (const key in streamArr) {
          this.recorder[key] = new MediaRecorder(streamArr[key], options[key]);
          this.recordData[key] = [];
          this.recorder[key].ondataavailable = e => {
            this.handleDataAvailable(e, key);
          };
          this.recorder[key].start();
          this.recorder[key].addEventListener('stop', () => {
            this.initVideoData();
          });
        }
      });
    },
  
    // 停止录屏，数据已经生成
    isFinishRecord() {
      clearTimeout(this.slientTimer);
      const stopRecordVideoPromise = new Promise(resolve => {
        this.recorder.canvas.addEventListener('stop', () => {
          resolve();
        });
      });
  
      const stopRecordAudioPromise = new Promise(resolve => {
        if (this.recorder.audio) {
          this.recorder.audio.addEventListener('stop', () => {
            resolve();
          });
        } else {
          resolve();
        }
      });
  
      return Promise.all([stopRecordVideoPromise, stopRecordAudioPromise]);
    },
  
    stopRecorder() {
      for (const key in this.recorder) {
        this.recorder[key].stop();
      }
    },
  
    initVideoData() {
      const options = {
        canvas: [
          { type: 'video/webm' },
          document.getElementById('recorder-video'),
        ],
        audio: [
          { type: 'audio/webm' },
          document.getElementById('recorder-audio'),
        ],
      };
  
      for (const key in this.recordData) {
        this.recordDataBuffer[key] = new Blob(
          this.recordData[key],
          options[key][0],
        );
      }
    },
  
    clearRecordData() {
      this.recordDataBuffer = {};
    },
  
    // 提供给上传用的数据
    getRecordData() {
      const canvasData = this.recordDataBuffer;
      return canvasData;
    },
  
    // 提供本地链接给其他需播放的地方
    getDataObjectUrl() {
      return {
        audio: this.recordDataBuffer.audio
          ? window.URL.createObjectURL(this.recordDataBuffer.audio)
          : '',
        canvas: window.URL.createObjectURL(this.recordDataBuffer.canvas),
      };
    },
  
    play() {
      document.getElementById('recorder-video').addEventListener('play', () => {
        this.play();
        const recordAudio = document.getElementById('recorder-audio');
        if (recordAudio.src) {
          recordAudio.play();
        }
      });
    },
  
    pause() {
      document.getElementById('recorder-video').addEventListener('pause', () => {
        this.pause();
        const recordAudio = document.getElementById('recorder-audio');
        if (recordAudio.src) {
          recordAudio.pause();
        }
      });
    },
  };
  
  export default Recorder;
  