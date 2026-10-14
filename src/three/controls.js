import * as THREE from 'three';
import { detectDevice } from './device.js';

export class FirstPersonControls {
  constructor(camera, domElement, callbacks = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.callbacks = callbacks;
    this.enabled = true;
    this.isTouch = detectDevice().isTouch;
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0021;
    this.speed = 4.8;
    this.keys = new Set();
    this.moveVector = { forward: 0, strafe: 0 };
    this.touchPointerId = null;
    this.touchLastX = 0;
    this.touchLastY = 0;
    this.bounds = { minX: -14, maxX: 14, minZ: -14, maxZ: 14 };
    this.yMin = 1.35;
    this.yMax = 4.6;
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onTouchPointerDown = this.onTouchPointerDown.bind(this);
    this.onTouchPointerMove = this.onTouchPointerMove.bind(this);
    this.onTouchPointerEnd = this.onTouchPointerEnd.bind(this);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.addEventListener('pointerdown', this.onTouchPointerDown, { passive: false });
    this.domElement.addEventListener('pointermove', this.onTouchPointerMove, { passive: false });
    this.domElement.addEventListener('pointerup', this.onTouchPointerEnd);
    this.domElement.addEventListener('pointercancel', this.onTouchPointerEnd);
  }

  applyLook(deltaX, deltaY) {
    this.yaw -= deltaX * this.sensitivity;
    this.pitch -= deltaY * this.sensitivity;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
  }

  onMouseMove(event) {
    if (!this.enabled || document.pointerLockElement !== this.domElement) return;
    this.applyLook(event.movementX, event.movementY);
  }

  // Touch look does not require pointer lock: the finger drag itself is the gesture.
  onTouchPointerDown(event) {
    if (!this.enabled || event.pointerType !== 'touch') return;
    if (this.touchPointerId !== null) return;
    this.touchPointerId = event.pointerId;
    this.touchLastX = event.clientX;
    this.touchLastY = event.clientY;
    if (event.cancelable) event.preventDefault();
  }

  onTouchPointerMove(event) {
    if (event.pointerType !== 'touch' || event.pointerId !== this.touchPointerId) return;
    const deltaX = event.clientX - this.touchLastX;
    const deltaY = event.clientY - this.touchLastY;
    this.touchLastX = event.clientX;
    this.touchLastY = event.clientY;
    if (event.cancelable) event.preventDefault();
    if (!this.enabled) return;
    this.applyLook(deltaX, deltaY);
  }

  onTouchPointerEnd(event) {
    if (event.pointerId !== this.touchPointerId) return;
    this.touchPointerId = null;
  }

  setMoveVector(x, z) {
    const strafe = Number.isFinite(x) ? x : 0;
    const forward = Number.isFinite(z) ? z : 0;
    this.moveVector.strafe = Math.max(-1, Math.min(1, strafe));
    this.moveVector.forward = Math.max(-1, Math.min(1, forward));
  }

  onKeyDown(event) {
    if (!this.enabled) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.code);
  }

  onPointerLockChange() {
    this.callbacks.onPointerLockChange?.(document.pointerLockElement === this.domElement);
  }

  isLocked() {
    return document.pointerLockElement === this.domElement;
  }

  requestLock() {
    if (this.enabled && this.domElement.requestPointerLock) {
      this.domElement.requestPointerLock();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  update(delta) {
    if (!this.enabled) return;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = this.speed * Math.min(delta, 0.05);

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      this.camera.position.addScaledVector(forward, speed);
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      this.camera.position.addScaledVector(forward, -speed);
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      this.camera.position.addScaledVector(right, -speed);
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      this.camera.position.addScaledVector(right, speed);
    }

    const inputForward = this.moveVector.forward;
    const inputStrafe = this.moveVector.strafe;
    const inputMagnitude = Math.hypot(inputForward, inputStrafe);
    if (inputMagnitude > 0) {
      const scale = inputMagnitude > 1 ? 1 / inputMagnitude : 1;
      if (inputForward !== 0) {
        this.camera.position.addScaledVector(forward, speed * inputForward * scale);
      }
      if (inputStrafe !== 0) {
        this.camera.position.addScaledVector(right, speed * inputStrafe * scale);
      }
    }

    this.camera.position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.camera.position.x));
    this.camera.position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.camera.position.z));
    this.camera.position.y = Math.max(this.yMin, Math.min(this.yMax, this.camera.position.y));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  setInitial(position, lookAt) {
    this.camera.position.copy(position);
    const direction = new THREE.Vector3().subVectors(lookAt, position);
    this.yaw = Math.atan2(-direction.x, -direction.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(direction.y / Math.max(direction.length(), 0.001), -1, 1));
  }

  setBounds(bounds, height) {
    if (bounds) {
      this.bounds.minX = Math.min(bounds.minX, bounds.maxX);
      this.bounds.maxX = Math.max(bounds.minX, bounds.maxX);
      this.bounds.minZ = Math.min(bounds.minZ, bounds.maxZ);
      this.bounds.maxZ = Math.max(bounds.minZ, bounds.maxZ);
    }
    if (height) {
      this.yMin = Math.max(1.2, Math.min(3.4, height * 0.3));
      this.yMax = Math.max(this.yMin + 1.8, height * 0.56);
    }
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.removeEventListener('pointerdown', this.onTouchPointerDown);
    this.domElement.removeEventListener('pointermove', this.onTouchPointerMove);
    this.domElement.removeEventListener('pointerup', this.onTouchPointerEnd);
    this.domElement.removeEventListener('pointercancel', this.onTouchPointerEnd);
    this.touchPointerId = null;
    this.moveVector.forward = 0;
    this.moveVector.strafe = 0;
  }
}
