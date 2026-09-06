import page from '../index.html?raw';
import styles from '../styles.css?raw';
import app from '../js/app.mjs?raw';
import chart from '../js/chart.mjs?raw';
import model from '../js/model.mjs?raw';
import cashflow from '../js/cashflow.mjs?raw';
import demo from '../js/demo.mjs?raw';
import assistant from '../js/assistant.mjs?raw';
import { createWorker } from './http.mjs';

export default createWorker({assets:{
  'index.html':page,'styles.css':styles,'js/app.mjs':app,'js/chart.mjs':chart,
  'js/model.mjs':model,'js/cashflow.mjs':cashflow,'js/demo.mjs':demo,'js/assistant.mjs':assistant,
}});
