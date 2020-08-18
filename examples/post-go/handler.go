package kubeless

import (
	"github.com/sirupsen/logrus"
	"github.com/kubeless/kubeless/pkg/functions"
)

// Handler returns the given data.
func Handler(event functions.Event, context functions.Context) (string, error) {
	logrus.Println(event)
	return event.Data, nil
}
