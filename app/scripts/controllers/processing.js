'use strict';

/**
 * @ngdoc function
 * @name dauriaSearchApp.controller:MainCtrl
 * @description
 * # MainCtrl
 * Controller of the dauriaSearchApp
 */
angular.module('dauriaSearchApp')
  .controller('ProcessingCtrl', ['$scope', '$filter', '$http', 'selectedResult', 'currentPolygonLayer','$modal',
              function($scope, $filter, $http, selectedResult, currentPolygonLayer, $modal) {


    console.log("выбранный снимок: ", selectedResult);

    var CALC_ENDPOINT="http://localhost:5000/calc";

    $scope.canConfirmProcessing = currentPolygonLayer != null;
    $scope.whatswrongwithyou = false;

    $scope.errorMessage = null;

    jQuery('input[type="checkbox"]').on('change', function() {
        jQuery('input[type="checkbox"]').not(this).prop('checked', false);
     });


    $scope.getAppendixFileName = function(bandsOrExp) {
      if (bandsOrExp instanceof Array) {
        return bandsOrExp.join("-");
      }
      else {
        return bandsOrExp.toUpperCase();
      }
    }



    $scope.processAndDownloadImage = function () {
      if (!$scope.canConfirmProcessing) {
        $scope.errorMessage = "Вы не очертили область интереса! Обработка снимков возможно только в рамках области интереса";

        $scope.modalInstance = $modal.open({
          templateUrl: 'views/noAOIModal.html',
          size: 'lg'
        });

        return;
      }

      $scope.errorMessage = null;

      $scope.modalInstance = $modal.open({
        templateUrl: 'views/pleaseWaitWhileProcessing.html',
        size: 'lg',
        keyboard: false,
        backdrop: 'static'
        });

        var selectedExpOrBands = jQuery("#selectProcessOption input[type='radio']:checked").val();

        console.log("Вот, что ты выбрал: ", selectedExpOrBands);

        var splittedSelectedExpOrBands = selectedExpOrBands.split('=');

        console.log("засплитили выбранный вариант обработки: ", splittedSelectedExpOrBands);

        var expOrBands = splittedSelectedExpOrBands[0];
        var valuefOfExpOrBands = splittedSelectedExpOrBands[1];

        var geoJsonObj = currentPolygonLayer.toGeoJSON();

        console.log("сформировали geojson: ", geoJsonObj);

        var targetQueryObj = { "aoi": geoJsonObj, "scene": selectedResult.product_id }
        targetQueryObj[expOrBands] = expOrBands === "bands" ? JSON.parse(valuefOfExpOrBands) : valuefOfExpOrBands;

        console.log("итоговый JSON перед отправкой: ", targetQueryObj);

        $http({
          method: "POST",
          url: CALC_ENDPOINT,
          data: targetQueryObj,
          responseType: 'arraybuffer'
          }).then(function successCallback(response) {
                    $scope.modalInstance.close();
                    console.log("вот этот ответ мы получили: ", response);

                    var file = new Blob([response.data], { type: 'image/tiff' }); // считаем, что success-блок - это всегда файлик

                    var appendix = $scope.getAppendixFileName(valuefOfExpOrBands);

                    saveAs(file, selectedResult.product_id + '-' + appendix + '.tif');
                  },
                    function errorCallback(response) {
                      console.log("что-то пошло не так в запросе на вычислении!!!: ", response);
                      $scope.modalInstance.close();
                      if (response.data) {
                        ///// посмотри тут ответ, как сконвертить к json
                        //// https://stackoverflow.com/questions/30052567/how-to-read-json-error-response-from-http-if-responsetype-is-arraybuffer
                        var decodedString = String.fromCharCode.apply(null, new Uint8Array(response.data));
                        var obj = JSON.parse(decodedString);
                        console.log(obj);
                        if (obj.message) {
                          $scope.errorMessage = obj.message;
                        }
                        else {
                          $scope.errorMessage = "Что-то пошло не так в запросе на обработку, попробуйте позднее!";
                          // дальше нужно как-то показать это сообщение юзеру
                        }
                        $scope.modalInstance = $modal.open({
                          templateUrl: 'views/errorMessageModal.html',
                          size: 'lg',
                          scope: $scope
                        });
                      }
                      else {
                        $scope.errorMessage = "Не удалось связаться с сервисом обработки!";
                        $scope.modalInstance = $modal.open({
                          templateUrl: 'views/errorMessageModal.html',
                          size: 'lg',
                          scope: $scope
                        });
                      }
                    });

                };

  }]);
