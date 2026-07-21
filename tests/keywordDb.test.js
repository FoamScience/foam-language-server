import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('keywordDb', () => {
  let keywords;

  test('setup: load keywords.json', () => {
    const keywordsPath = join(__dirname, '../lib/foamfile-language-service/data/keywords.json');
    keywords = JSON.parse(readFileSync(keywordsPath, 'utf-8'));
    assert.ok(keywords, 'keywords should load');
  });

  test('JSON structure is valid', () => {
    assert.ok(typeof keywords === 'object', 'keywords should be an object');
    assert.ok(Object.keys(keywords).length > 0, 'keywords should have entries');
  });

  test('all entries have non-empty doc strings', () => {
    for (const [section, entries] of Object.entries(keywords)) {
      for (const [keyword, def] of Object.entries(entries)) {
        assert.ok(def.doc && typeof def.doc === 'string' && def.doc.trim().length > 0,
          `${section}.${keyword} must have a non-empty doc string`);
      }
    }
  });

  test('all values arrays are non-empty arrays of strings', () => {
    for (const [section, entries] of Object.entries(keywords)) {
      for (const [keyword, def] of Object.entries(entries)) {
        if (def.values) {
          assert.ok(Array.isArray(def.values),
            `${section}.${keyword}.values must be an array`);
          assert.ok(def.values.length > 0,
            `${section}.${keyword}.values must not be empty`);
          for (const v of def.values) {
            assert.ok(typeof v === 'string' && v.trim().length > 0,
              `${section}.${keyword} has empty or non-string value`);
          }
        }
      }
    }
  });

  test('total keyword count is >= 140', () => {
    let total = 0;
    for (const entries of Object.values(keywords)) {
      total += Object.keys(entries).length;
    }
    assert.ok(total >= 140, `total keywords (${total}) should be >= 140`);
  });

  test('snappyHexMeshDict section has new entries', () => {
    const snap = keywords.snappyHexMeshDict;
    assert.ok(snap, 'snappyHexMeshDict section should exist');

    // Check some key entries
    assert.ok(snap.castellatedMesh, 'should have castellatedMesh');
    assert.ok(snap.snap, 'should have snap');
    assert.ok(snap.addLayers, 'should have addLayers');
    assert.ok(snap.geometry, 'should have geometry');
    assert.ok(snap.castellatedMeshControls, 'should have castellatedMeshControls');
    assert.ok(snap.snapControls, 'should have snapControls');
    assert.ok(snap.addLayersControls, 'should have addLayersControls');
    assert.ok(snap.meshQualityControls, 'should have meshQualityControls');
  });

  test('snappyHexMeshDict addLayers has correct values', () => {
    const addLayers = keywords.snappyHexMeshDict.addLayers;
    assert.ok(addLayers.values, 'addLayers should have values');
    assert.ok(addLayers.values.includes('yes'), 'addLayers should have yes');
    assert.ok(addLayers.values.includes('no'), 'addLayers should have no');
  });

  test('setFieldsDict section exists with source types', () => {
    const setFields = keywords.setFieldsDict;
    assert.ok(setFields, 'setFieldsDict section should exist');
    assert.ok(setFields.defaultFieldValues, 'should have defaultFieldValues');
    assert.ok(setFields.regions, 'should have regions');
    assert.ok(setFields.boxToCell, 'should have boxToCell');
    assert.ok(setFields.sphereToCell, 'should have sphereToCell');
    assert.ok(setFields.cylinderToCell, 'should have cylinderToCell');
    assert.ok(setFields.zoneToCell, 'should have zoneToCell');
  });

  test('turbulenceProperties has RAS and LES models', () => {
    const turb = keywords.turbulenceProperties;
    assert.ok(turb.RASModel, 'should have RASModel');
    assert.ok(turb.RASModel.values, 'RASModel should have values');
    assert.ok(turb.RASModel.values.includes('kOmegaSST'), 'should have kOmegaSST');
    assert.ok(turb.RASModel.values.includes('kEpsilon'), 'should have kEpsilon');

    assert.ok(turb.LESModel, 'should have LESModel');
    assert.ok(turb.LESModel.values, 'LESModel should have values');
    assert.ok(turb.LESModel.values.includes('Smagorinsky'), 'should have Smagorinsky');
  });

  test('boundaryField has well-known BC parameters', () => {
    const bf = keywords.boundaryField;
    assert.ok(bf.inletValue, 'should have inletValue');
    assert.ok(bf.refValue, 'should have refValue');
    assert.ok(bf.refGradient, 'should have refGradient');
    assert.ok(bf.valueFraction, 'should have valueFraction');
    assert.ok(bf.gradient, 'should have gradient');
    assert.ok(bf.phi, 'should have phi');
    assert.ok(bf.p0, 'should have p0');
    assert.ok(bf.U, 'should have U');
  });

  test('fvSolution has PIMPLE and solver control keywords', () => {
    const fvSol = keywords.fvSolution;
    assert.ok(fvSol.nOuterCorrectors, 'should have nOuterCorrectors');
    assert.ok(fvSol.momentumPredictor, 'should have momentumPredictor');
    assert.ok(fvSol.momentumPredictor.values, 'momentumPredictor should have values');
    assert.ok(fvSol.momentumPredictor.values.includes('yes'), 'momentumPredictor should have yes');
    assert.ok(fvSol.pRefCell, 'should have pRefCell');
    assert.ok(fvSol.pRefValue, 'should have pRefValue');
    assert.ok(fvSol.mergeLevels, 'should have mergeLevels');
  });

  test('fvSchemes has wallDist and fluxRequired', () => {
    const fvSchemes = keywords.fvSchemes;
    assert.ok(fvSchemes.wallDist, 'should have wallDist');
    assert.ok(fvSchemes.method, 'should have method');
    assert.ok(fvSchemes.method.values, 'method should have values');
    assert.ok(fvSchemes.method.values.includes('meshWave'), 'method should have meshWave');
    assert.ok(fvSchemes.method.values.includes('Poisson'), 'method should have Poisson');
    assert.ok(fvSchemes.fluxRequired, 'should have fluxRequired');
  });

  test('controlDict has graphFormat', () => {
    const controlDict = keywords.controlDict;
    assert.ok(controlDict.graphFormat, 'should have graphFormat');
    assert.ok(controlDict.graphFormat.values, 'graphFormat should have values');
    assert.ok(controlDict.graphFormat.values.includes('raw'), 'should have raw');
    assert.ok(controlDict.graphFormat.values.includes('gnuplot'), 'should have gnuplot');
  });

  test('decomposeParDict has decomposition coefficients', () => {
    const decomp = keywords.decomposeParDict;
    assert.ok(decomp.simpleCoeffs, 'should have simpleCoeffs');
    assert.ok(decomp.order, 'should have order');
    assert.ok(decomp.order.values, 'order should have values');
    assert.ok(decomp.order.values.includes('xyz'), 'should have xyz');
    assert.ok(decomp.hierarchicalCoeffs, 'should have hierarchicalCoeffs');
    assert.ok(decomp.scotchCoeffs, 'should have scotchCoeffs');
    assert.ok(decomp.distributed, 'should have distributed');
  });

  test('entries per section match expected ranges', () => {
    const sections = {
      '*': { min: 8, max: 10 },
      'blockMeshDict': { min: 7, max: 8 },
      'boundaryField': { min: 12, max: 15 },
      'controlDict': { min: 20, max: 25 },
      'decomposeParDict': { min: 10, max: 15 },
      'fvSchemes': { min: 9, max: 12 },
      'fvSolution': { min: 20, max: 25 },
      'setFieldsDict': { min: 6, max: 8 },
      'snappyHexMeshDict': { min: 30, max: 40 },
      'transportProperties': { min: 2, max: 3 },
      'turbulenceProperties': { min: 7, max: 10 }
    };

    for (const [section, range] of Object.entries(sections)) {
      const count = Object.keys(keywords[section] || {}).length;
      assert.ok(count >= range.min && count <= range.max,
        `${section} count (${count}) should be between ${range.min} and ${range.max}`);
    }
  });
});
